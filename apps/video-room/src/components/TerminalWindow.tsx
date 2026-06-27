import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalInputMessage, terminalResizeMessage } from '../lib/terminalProtocol';

export interface TerminalWindowProps {
  wsUrl: string;
}

export function TerminalWindow({ wsUrl }: TerminalWindowProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"Courier New", "Lucida Console", monospace',
      fontSize: 13,
      theme: {
        background: '#000000',
        foreground: '#c0c0c0',
        cursor: '#ffffff',
        selectionBackground: '#000080',
        black: '#000000',
        red: '#800000',
        green: '#008000',
        yellow: '#808000',
        blue: '#000080',
        magenta: '#800080',
        cyan: '#008080',
        white: '#c0c0c0',
        brightBlack: '#808080',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#0000ff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
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
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          term.write(event.data);
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
      }
    });

    // Resize handling
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(terminalResizeMessage(cols, rows));
      }
    });

    // Window resize observer
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
    };
  }, [wsUrl]);

  return (
    <div className="win95-terminal-container" ref={containerRef} />
  );
}
