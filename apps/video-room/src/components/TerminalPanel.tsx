import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  collectTerminalCommands,
  terminalCommandInputData,
  terminalInputMessage,
  terminalOutputEvidenceText,
  terminalResizeMessage,
} from '../lib/terminalProtocol';

export interface TerminalPanelProps {
  wsUrl: string;
  onCommand?: (command: string) => void;
  onOutput?: (output: string) => void;
  queuedCommand?: string | null;
  queuedCommandRequest?: number;
  onQueuedCommandSent?: (command: string, request: number) => void;
}

export function TerminalPanel({
  wsUrl,
  onCommand,
  onOutput,
  queuedCommand,
  queuedCommandRequest = 0,
  onQueuedCommandSent,
}: TerminalPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const commandBufferRef = useRef('');
  const queuedCommandRef = useRef<string | null>(null);
  const queuedCommandRequestRef = useRef(0);
  const sentQueuedCommandRequestRef = useRef(0);
  const onCommandRef = useRef(onCommand);
  const onQueuedCommandSentRef = useRef(onQueuedCommandSent);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    onQueuedCommandSentRef.current = onQueuedCommandSent;
  }, [onQueuedCommandSent]);

  const flushQueuedCommand = (): void => {
    const request = queuedCommandRequestRef.current;
    const command = queuedCommandRef.current?.trim();
    if (!command || request <= 0 || sentQueuedCommandRequestRef.current === request) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    sentQueuedCommandRequestRef.current = request;
    ws.send(terminalInputMessage(terminalCommandInputData(command)));
    onCommandRef.current?.(command);
    onQueuedCommandSentRef.current?.(command, request);
  };

  useEffect(() => {
    queuedCommandRef.current = queuedCommand ?? null;
    queuedCommandRequestRef.current = queuedCommandRequest;
    flushQueuedCommand();
  }, [queuedCommand, queuedCommandRequest]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#01050b',
        foreground: '#dbeafe',
        cursor: '#bfdbfe',
        selectionBackground: '#1d4ed8',
        black: '#000000',
        red: '#f87171',
        green: '#34d399',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#67e8f9',
        white: '#dbeafe',
        brightBlack: '#64748b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff',
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    term.write('Connecting to container...\r\n');

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        term.write('\r\x1b[2KConnected!\r\n');
        ws.send(terminalResizeMessage(term.cols, term.rows));
        flushQueuedCommand();
      };

      ws.onmessage = (event) => {
        let outputText: string;
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          term.write(bytes);
          outputText = new TextDecoder().decode(bytes);
        } else {
          outputText = String(event.data);
          term.write(outputText);
        }
        const evidenceText = terminalOutputEvidenceText(outputText);
        if (evidenceText) {
          onOutput?.(evidenceText);
        }
      };

      ws.onclose = () => {
        term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
      };

      ws.onerror = () => {
        term.write('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
      };
    } catch (err) {
      term.write(`\x1b[31mFailed to connect: ${err}\x1b[0m\r\n`);
    }

    // Terminal input → WebSocket
    const inputDisposable = term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(terminalInputMessage(data));
        const result = collectTerminalCommands(commandBufferRef.current, data);
        commandBufferRef.current = result.buffer;
        result.commands.forEach((command) => onCommandRef.current?.(command));
      }
    });

    // Resize handling
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(terminalResizeMessage(cols, rows));
      }
    });

    // Panel resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    // Focus terminal
    term.focus();

    return () => {
      inputDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      commandBufferRef.current = '';
    };
  }, [onOutput, wsUrl]);

  return (
    <div className="terminal-container" ref={containerRef} />
  );
}
