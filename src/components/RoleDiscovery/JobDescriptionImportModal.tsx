/**
 * JobDescriptionImportModal — Paste or upload a job description and have
 * Gemma 4 extract baseline fields (title, department, company, location).
 *
 * Owns its own JD-import state. Parent only receives the parsed result via
 * `onParsed`, then the modal closes itself.
 *
 * Mirrors the StatusOverrideModal pattern (backdrop + panel + close button).
 */

import { useRef, useState } from 'react';
import { X, Sparkles, Upload, FileText, Loader2 } from 'lucide-react';
import { TextareaInput } from '../ui/form';
import { useApiClient } from '../../hooks/useApiClient';
import type { ParseJDResponse } from '../../lib/api/types';

interface JobDescriptionImportModalProps {
  onParsed: (parsed: ParseJDResponse['parsed']) => void;
  onClose: () => void;
}

export function JobDescriptionImportModal({
  onParsed,
  onClose,
}: JobDescriptionImportModalProps): JSX.Element {
  const api = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const canParseText = jdText.trim().length >= 20 && !isParsing;

  const handleParseText = async (): Promise<void> => {
    if (!canParseText) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const data = await api.post<ParseJDResponse>(
        '/api/v1/role-contexts/parse-jd',
        { text: jdText },
      );
      onParsed(data.parsed);
      onClose();
    } catch (err) {
      console.error('[JobDescriptionImportModal] parse text failed:', err);
      setParseError(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setParseError('Only PDF files are supported.');
      return;
    }
    setJdFile(file);
    setIsParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // useApiClient is JSON-only — multipart needs raw fetch.
      const baseUrl = import.meta.env?.VITE_API_URL || 'http://localhost:8787';
      const clerkWindow = window as {
        Clerk?: { session?: { getToken: () => Promise<string> } };
      };
      const token = await clerkWindow.Clerk?.session?.getToken();

      const response = await fetch(`${baseUrl}/api/v1/role-contexts/parse-jd`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message ?? `Upload failed (${response.status})`,
        );
      }

      const data = (await response.json()) as ParseJDResponse;
      onParsed(data.parsed);
      onClose();
    } catch (err) {
      console.error('[JobDescriptionImportModal] parse file failed:', err);
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsParsing(false);
    }
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: '#13131a',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 6,
              }}
            >
              IMPORT_JOB_DESCRIPTION
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--pipe-text-muted, rgba(255,255,255,0.55))',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              Paste a JD or upload a PDF — we'll extract the basics.
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isParsing}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: isParsing ? 'default' : 'pointer',
              padding: 0,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Paste textarea */}
        <div style={{ marginBottom: 16 }}>
          <TextareaInput
            value={jdText}
            onChange={setJdText}
            placeholder="Paste a job description here..."
            rows={8}
          />
        </div>

        {/* Parse text button */}
        <button
          onClick={handleParseText}
          disabled={!canParseText}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: canParseText
              ? 'rgba(74, 222, 128, 0.08)'
              : 'transparent',
            border: canParseText
              ? '1px solid rgba(74, 222, 128, 0.3)'
              : '1px solid rgba(255,255,255,0.06)',
            color: canParseText
              ? 'rgba(74, 222, 128, 0.9)'
              : 'rgba(255,255,255,0.2)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: canParseText ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 20,
          }}
        >
          {isParsing ? (
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Sparkles size={12} />
          )}
          PARSE_TEXT
        </button>

        {/* OR divider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 1,
              background: 'rgba(255,255,255,0.06)',
            }}
          />
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            OR
          </span>
          <div
            style={{
              flex: 1,
              height: 1,
              background: 'rgba(255,255,255,0.06)',
            }}
          />
        </div>

        {/* Upload PDF dropzone */}
        <div
          onClick={() => !isParsing && fileInputRef.current?.click()}
          style={{
            padding: '24px 20px',
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 8,
            cursor: isParsing ? 'default' : 'pointer',
            fontSize: 11,
            fontFamily: '"Space Mono", monospace',
            color: 'rgba(255,255,255,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            textAlign: 'center',
          }}
        >
          {jdFile ? (
            <>
              <FileText size={14} />
              {jdFile.name}
            </>
          ) : (
            <>
              <Upload size={14} />
              UPLOAD_PDF
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* Error */}
        {parseError && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              background: 'rgba(248, 113, 113, 0.08)',
              border: '1px solid rgba(248, 113, 113, 0.2)',
              borderRadius: 4,
              fontSize: 11,
              color: 'rgba(248, 113, 113, 0.9)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {parseError}
          </div>
        )}
      </div>
    </div>
  );
}
