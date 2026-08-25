'use strict';
/**
 * hooks/antigravity-bridge.js
 * Unified hook bridge for Google Antigravity CLI (agy).
 * Maps Antigravity lifecycle hook events to AgentSystem hooks.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function logDebug(msg) {
  // Best-effort debugging log
  try {
    fs.appendFileSync(path.join(require('node:os').homedir(), '.gemini', 'agentsystem-hook-debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function cleanArg(val) {
  if (typeof val === 'string') {
    let s = val.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
    return s;
  }
  return val;
}

function getPromptFromTranscript(transcriptPath) {
  try {
    if (!fs.existsSync(transcriptPath)) return '';
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'USER_INPUT') {
          return obj.content || '';
        }
      } catch (e) {}
    }
  } catch (e) {
    logDebug(`Error reading prompt from transcript: ${e.message}`);
  }
  return '';
}

function getToolCallAndInput(transcriptPath, stepIdx) {
  try {
    if (!fs.existsSync(transcriptPath)) return null;
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    
    // Find the planner response that produced this step. It's usually the closest preceding step with tool_calls
    const precedingSteps = lines
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(o => o && o.step_index < stepIdx && o.tool_calls && o.tool_calls.length > 0)
      .sort((a, b) => b.step_index - a.step_index);
      
    if (precedingSteps.length > 0) {
      return precedingSteps[0].tool_calls[0];
    }
  } catch (e) {
    logDebug(`Error parsing tool call at step ${stepIdx}: ${e.message}`);
  }
  return null;
}

/**
 * Runs a hook to completion and reports the child's EXIT STATUS alongside its output (#514).
 *
 * The old `runHookSync` returned `''` for every non-zero exit, so the one status that carries
 * meaning in the Claude Code hook protocol -- exit 2, "deny this tool call" -- arrived here
 * indistinguishable from an allow that printed nothing. `guard-git.sh` exits 2 and writes its
 * BLOCKED line to stderr, and stderr was inherited rather than captured, so the deny was inert on
 * `agy` twice over: no status to read and no text to sniff either.
 *
 * `spawnSync` replaces `execFileSync` because a non-zero exit is a normal, expected outcome here
 * rather than an exception -- throwing on it is precisely what discarded the status.
 *
 * @returns {{status: number|null, stdout: string, stderr: string}} `status` is null when the child
 *   could not be started, or was killed by a signal or the timeout -- i.e. when no exit code
 *   exists at all.
 */
function runHookCaptured(scriptName, args, payload, workspacePath) {
  if (typeof args === 'object' && !Array.isArray(args)) {
    payload = args;
    args = [];
  }
  const isBash = scriptName.endsWith('.sh');
  const scriptPath = path.join(__dirname, scriptName);

  let cmd = process.execPath;
  let cmdArgs = [scriptPath, ...args];

  if (isBash) {
    cmd = 'bash';
    cmdArgs = [scriptPath, ...args];
  }

  logDebug(`Executing sync hook: ${scriptName} (cwd: ${workspacePath})`);
  const res = spawnSync(cmd, cmdArgs, {
    input: JSON.stringify(payload),
    cwd: workspacePath,
    encoding: 'utf8',
    timeout: 15000
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  if (res.error) {
    logDebug(`Failed sync hook ${scriptName}: ${res.error.message}`);
    return { status: null, stdout, stderr };
  }
  if (res.status === null) {
    logDebug(`Sync hook ${scriptName} killed by ${res.signal || 'unknown signal'} (no exit code)`);
    return { status: null, stdout, stderr };
  }
  if (res.status !== 0) {
    logDebug(`Sync hook ${scriptName} exited ${res.status}: ${(stderr || stdout).trim()}`);
  }
  return { status: res.status, stdout, stderr };
}

/**
 * stdout-only wrapper for the call sites that never wanted a status: the PreInvocation context
 * injectors and the Stop-phase bookkeeping hooks. Their contract is deliberately unchanged -- a
 * crashing bookkeeping hook must not turn into a blocked tool call, so failure still collapses to
 * `''` and fails OPEN.
 */
function runHookSync(scriptName, args, payload, workspacePath) {
  const { status, stdout } = runHookCaptured(scriptName, args, payload, workspacePath);
  return status === 0 ? stdout : '';
}

/**
 * Like runHookSync, but keeps the exit status and both streams. runHookSync returns '' whenever
 * the child exits non-zero, which is exactly what a DENYING hook does — so a deny is
 * indistinguishable there from an empty allow. #508's secret guard denies with exit 2 and must
 * be honoured on this host too.
 */
function runHookCapture(scriptName, payload, workspacePath) {
  const isBash = scriptName.endsWith('.sh');
  const scriptPath = path.join(__dirname, scriptName);
  const cmd = isBash ? 'bash' : process.execPath;
  try {
    const stdout = execFileSync(cmd, [scriptPath], {
      input: JSON.stringify(payload), cwd: workspacePath, encoding: 'utf8', timeout: 15000,
    });
    return { status: 0, out: String(stdout || '') };
  } catch (e) {
    // Never log e.message here: for a guard whose input is a command line, the message can
    // carry the command back into the debug log.
    return { status: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

function runHookAsync(scriptName, args, payload, workspacePath) {
  if (typeof args === 'object' && !Array.isArray(args)) {
    payload = args;
    args = [];
  }
  const isBash = scriptName.endsWith('.sh');
  const scriptPath = path.join(__dirname, scriptName);
  
  let cmd = process.execPath;
  let cmdArgs = [scriptPath, ...args];
  
  if (isBash) {
    cmd = 'bash';
    cmdArgs = [scriptPath, ...args];
  }
  
  logDebug(`Spawning async hook: ${scriptName} (cwd: ${workspacePath})`);
  try {
    const child = spawn(cmd, cmdArgs, {
      cwd: workspacePath,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.unref();
  } catch (e) {
    logDebug(`Failed async spawn ${scriptName}: ${e.message}`);
  }
}

function handlePreInvocation(payload, workspacePath) {
  const promptText = getPromptFromTranscript(payload.transcriptPath);
  const invocationNum = payload.invocationNum || 1;
  
  const subPayload = {
    prompt: promptText,
    session_id: payload.conversationId,
    transcript_path: payload.transcriptPath,
    source: invocationNum === 1 ? 'startup' : 'resume'
  };
  
  let combinedMsg = '';
  
  if (invocationNum === 1) {
    logDebug('Running SessionStart hooks for Antigravity');
    const memCtx = runHookSync('memory-context-inject.js', subPayload, workspacePath);
    if (memCtx && memCtx.trim() !== 'OK') combinedMsg += memCtx.trim() + '\n\n';
    
    const routinesCtx = runHookSync('routines-context-inject.js', subPayload, workspacePath);
    if (routinesCtx && routinesCtx.trim() !== 'OK') combinedMsg += routinesCtx.trim() + '\n\n';
    
    runHookAsync('claude-hooks/session-start.sh', subPayload, workspacePath);
    runHookAsync('continuous-sync-hook.js', ['--phase=start'], subPayload, workspacePath);
  }
  
  const routerHint = runHookSync('memory-router.js', subPayload, workspacePath);
  if (routerHint && routerHint.trim() !== 'OK') {
    combinedMsg += routerHint.trim() + '\n';
  }
  
  runHookAsync('claude-hooks/user-prompt-submit.sh', subPayload, workspacePath);
  
  const injectSteps = [];
  if (combinedMsg.trim()) {
    injectSteps.push({
      ephemeralMessage: combinedMsg.trim()
    });
  }
  
  console.log(JSON.stringify({ injectSteps }));
}

function handlePreToolUse(payload, workspacePath) {
  const toolCall = payload.toolCall;
  if (!toolCall) {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }
  
  if (toolCall.name === 'run_command') {
    const cmdLine = cleanArg(toolCall.args.CommandLine);
    const subPayload = {
      tool_name: 'Bash',
      tool_input: {
        command: cmdLine
      }
    };
    
    // Secret guard FIRST (#508), and deliberately before the logDebug below: that line writes
    // the command — literal secret included — to the debug log, so the guard must have had its
    // say before anything renders the command anywhere.
    const secrets = runHookCapture('guard-secrets.js', subPayload, workspacePath);
    if (secrets.status === 2) {
      logDebug('Blocked by guard-secrets: inlined literal secret'); // never log the command here
      console.log(JSON.stringify({ decision: 'deny', reason: secrets.out.trim() }));
      return;
    }

    logDebug(`Running PreToolUse git-guard for command: ${cmdLine}`);
    const { status, stdout, stderr } = runHookCaptured('claude-hooks/guard-git.sh', subPayload, workspacePath);

    // Exit 2 is the ONLY deny code in the Claude Code hook protocol, and the status IS the whole
    // decision: the reason text is a courtesy for the transcript, never the predicate. The old
    // "does the output contain BLOCKED:" test could not have worked -- guard-git.sh writes that
    // line to stderr, and stderr was not captured (#514).
    //
    // Every other non-zero status fails OPEN. A hook that crashes -- no `jq`, no `bash` on PATH, a
    // syntax error, the 15s timeout -- would otherwise brick every tool call for the rest of the
    // session, which is a much worse outcome than one unguarded command.
    if (status === 2) {
      const reason = stderr.trim() || stdout.trim() || 'blocked by guard-git.sh (exit 2)';
      logDebug(`Blocked (exit 2): ${reason}`);
      console.log(JSON.stringify({
        decision: 'deny',
        reason
      }));
      return;
    }
    if (status !== 0) {
      logDebug(`guard-git.sh exited ${status === null ? 'without a code' : status} - failing open`);
    }
  }
  
  console.log(JSON.stringify({ decision: 'allow' }));
}

function handlePostToolUse(payload, workspacePath) {
  const toolCall = getToolCallAndInput(payload.transcriptPath, payload.stepIdx);
  if (toolCall) {
    let toolName = toolCall.name;
    let toolInput = {};
    if (toolName === 'run_command') {
      toolName = 'Bash';
      toolInput = { command: cleanArg(toolCall.args.CommandLine) };
    } else if (toolName === 'replace_file_content') {
      toolName = 'Edit';
      toolInput = { file_path: cleanArg(toolCall.args.TargetFile) };
    } else if (toolName === 'write_to_file') {
      toolName = 'Write';
      toolInput = { file_path: cleanArg(toolCall.args.TargetFile) };
    }
    
    const subPayload = {
      session_id: payload.conversationId,
      tool_name: toolName,
      tool_input: toolInput
    };
    
    if (toolName === 'Edit' || toolName === 'Write') {
      runHookSync('claude-hooks/wip-checkpoint.sh', subPayload, workspacePath);
    } else if (toolName === 'Bash') {
      runHookSync('routine-dispatch.js', subPayload, workspacePath);
      runHookSync('claude-hooks/pr-status-detect.sh', subPayload, workspacePath);
    }
  }
  
  console.log(JSON.stringify({}));
}

function handleStop(payload, workspacePath) {
  const subPayload = {
    session_id: payload.conversationId,
    transcript_path: payload.transcriptPath,
    workspace_paths: payload.workspacePaths
  };
  
  logDebug('Running Stop / SessionEnd hooks for Antigravity');
  
  // Run all Stop and SessionEnd hooks synchronously
  runHookSync('sona-writeback-hook.js', subPayload, workspacePath);
  runHookSync('injection-feedback-hook.js', subPayload, workspacePath);
  runHookSync('routine-compliance-hook.js', subPayload, workspacePath);
  runHookSync('claude-hooks/session-end.sh', subPayload, workspacePath);
  runHookSync('memory-capture-hook.js', subPayload, workspacePath);
  runHookSync('claude-hooks/session-close.sh', subPayload, workspacePath);
  runHookSync('session-auto-rename-hook.js', subPayload, workspacePath);
  runHookSync('continuous-sync-hook.js', ['--phase=end'], subPayload, workspacePath);
  
  console.log(JSON.stringify({}));
}

function main() {
  const eventType = process.argv[2];
  let input = '';
  
  process.stdin.on('data', chunk => {
    input += chunk;
  });
  
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(input || '{}');
    } catch (e) {
      logDebug(`Error parsing input JSON for event ${eventType}: ${e.message}`);
    }
    
    const workspacePath = (payload.workspacePaths && payload.workspacePaths[0]) || process.cwd();
    logDebug(`Received Antigravity event: ${eventType} in ${workspacePath}`);
    
    switch (eventType) {
      case 'PreInvocation':
        handlePreInvocation(payload, workspacePath);
        break;
      case 'PreToolUse':
        handlePreToolUse(payload, workspacePath);
        break;
      case 'PostToolUse':
        handlePostToolUse(payload, workspacePath);
        break;
      case 'Stop':
        handleStop(payload, workspacePath);
        break;
      default:
        console.log(JSON.stringify({}));
        break;
    }
  });
}

module.exports = { runHookCaptured, runHookSync };

if (require.main === module) main();
