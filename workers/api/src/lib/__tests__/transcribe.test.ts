import { describe, expect, it } from 'vitest';
import { parseDeepgramStructuredTranscription } from '../transcribe';

describe('parseDeepgramStructuredTranscription', () => {
  it('preserves chronological multichannel utterances and unseen speaker labels', () => {
    const result = parseDeepgramStructuredTranscription({
      metadata: { channels: 2 },
      results: {
        utterances: [
          {
            id: 'provider-b',
            transcript: 'Guest answer.',
            start: 2.1,
            end: 4.25,
            confidence: 0.93,
            channel: 1,
            speaker: 17,
          },
          {
            id: 'provider-a',
            transcript: 'Host question?',
            start: 0.5,
            end: 1.8,
            confidence: 0.98,
            channel: 0,
            speaker: 3,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      provider: 'deepgram',
      model: 'nova-3',
      channelCount: 2,
      transcript: 'Host question?\n\nGuest answer.',
      segments: [
        {
          stableSegmentId: 'utterance-0001',
          text: 'Host question?',
          channel: 0,
          speakerLabel: 'speaker-3',
          timestampStartMs: 500,
          timestampEndMs: 1800,
          confidence: 0.98,
          providerSegmentId: 'provider-a',
        },
        {
          stableSegmentId: 'utterance-0002',
          text: 'Guest answer.',
          channel: 1,
          speakerLabel: 'speaker-17',
          timestampStartMs: 2100,
          timestampEndMs: 4250,
          confidence: 0.93,
          providerSegmentId: 'provider-b',
        },
      ],
    });
  });

  it('falls back to channel alternatives without fabricating timing', () => {
    const result = parseDeepgramStructuredTranscription({
      results: {
        channels: [{
          alternatives: [{
            transcript: 'Source words without timing.',
            confidence: 0.8,
            words: [{ word: 'Source' }, { word: 'timing' }],
          }],
        }],
      },
    });

    expect(result?.segments).toEqual([{
      stableSegmentId: 'utterance-0001',
      text: 'Source words without timing.',
      channel: 0,
      speakerLabel: null,
      timestampStartMs: null,
      timestampEndMs: null,
      confidence: 0.8,
      providerSegmentId: null,
    }]);
  });

  it('returns null for malformed or empty provider output', () => {
    expect(parseDeepgramStructuredTranscription(null)).toBeNull();
    expect(parseDeepgramStructuredTranscription({ results: { utterances: [] } })).toBeNull();
  });
});
