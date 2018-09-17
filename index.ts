import signalExit from 'signal-exit';
import { ChildProcess, SpawnOptions } from "child_process";
const spawn = process.platform === 'win32' ? require('cross-spawn') : require('child_process').spawn;

type CloseHandler = (done: () => void) => any;

/**
 * @internal
 */
interface NormalizedArguments {
  readonly program: string;
  readonly args: ReadonlyArray<string>;
  readonly cb: CloseHandler;
}

/**
 * Normalizes the arguments passed to `foregroundChild`.
 *
 * See the signature of `foregroundChild` for the supported arguments.
 *
 * @param fgArgs Array of arguments passed to `foregroundChild`.
 * @return Normalized arguments
 * @internal
 */
function normalizeFgArgs(fgArgs: any[]): NormalizedArguments {
  let program: string;
  let args: ReadonlyArray<string>;
  let cb: CloseHandler;

  let processArgsEnd: number = fgArgs.length;
  const lastArg: any = fgArgs[fgArgs.length - 1];
  if (typeof lastArg === "function") {
    cb = lastArg;
    processArgsEnd--;
  } else {
    cb = (done: () => void) => done();
  }

  if (Array.isArray(fgArgs[0])) {
    [program, ...args] = fgArgs[0];
  } else {
    program = fgArgs[0];
    args = Array.isArray(fgArgs[1]) ? fgArgs[1] : fgArgs.slice(1, processArgsEnd);
  }

  return {program, args, cb};
}

function foregroundChild(program: string | ReadonlyArray<string>, cb?: CloseHandler);
function foregroundChild(program: string, args: ReadonlyArray<string>, cb?: CloseHandler);
function foregroundChild(program: string, arg1: string, cb?: CloseHandler);
function foregroundChild(program: string, arg1: string, arg2: string, cb?: CloseHandler);
function foregroundChild(program: string, arg1: string, arg2: string, arg3: string, cb?: CloseHandler);
function foregroundChild(program: string, arg1: string, arg2: string, arg3: string, arg4: string, cb?: CloseHandler);
function foregroundChild (...fgArgs: any[]): ChildProcess {
  const {program, args, cb} = normalizeFgArgs(fgArgs);

  const spawnOpts: SpawnOptions = {
    stdio: process.send !== undefined ? [0, 1, 2, "ipc"] : [0, 1, 2],
  }

  const child: ChildProcess = spawn(program, args, spawnOpts);

  let childExited = false;
  const unproxySignals: UnproxySignals = proxySignals(child);
  process.on('exit', childHangup);
  function childHangup () {
    child.kill('SIGHUP');
  }

  child.on('close', function (code: number, signal: string) {
    // Allow the callback to inspect the child’s exit code and/or modify it.
    process.exitCode = signal ? 128 + signal : code as any;

    cb(() => {
      unproxySignals();
      process.removeListener('exit', childHangup);
      childExited = true;
      if (signal) {
        // If there is nothing else keeping the event loop alive,
        // then there's a race between a graceful exit and getting
        // the signal to this process.  Put this timeout here to
        // make sure we're still alive to get the signal, and thus
        // exit with the intended signal code.
        setTimeout(() => {}, 200);
        process.kill(process.pid, signal);
      } else {
        // Equivalent to process.exit() on Node.js >= 0.11.8
        process.exit(process.exitCode);
      }
    })
  });

  if (process.send !== undefined) {
    process.removeAllListeners('message');

    child.on('message', (message, sendHandle) => {
      process.send!(message, sendHandle);
    });

    process.on('message', (message, sendHandle) => {
      child.send(message, sendHandle);
    });
  }

  return child;
}

/**
 * @internal
 */
type UnproxySignals = () => void;

function proxySignals (child: ChildProcess): UnproxySignals {
  const listeners: Record<NodeJS.Signals, NodeJS.SignalsListener> = Object.create(null);

  for (const sig of signalExit.signals()) {
    const listener: NodeJS.SignalsListener = () => child.kill(sig);
    listeners[sig] = listener;
    process.on(sig, listener);
  }

  return unproxySignals;

  function unproxySignals () {
    for (const sig in listeners) {
      process.removeListener(sig, listeners[sig as NodeJS.Signals]);
    }
  }
}

// These TS exports are only there to generate the type definitions, they will be overwritten by the CJS exports below
export {
  CloseHandler,
  foregroundChild,
};

module.exports = foregroundChild;
Object.assign(module.exports, {
  foregroundChild,
});
