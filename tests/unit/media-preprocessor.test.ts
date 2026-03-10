import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MediaPreprocessor } from '../../src/media/services/MediaPreprocessor';
import type { SpeechToTextPort } from '../../src/media/contracts/SpeechToTextPort';
import type { NormalizedInput } from '../../src/channels/contracts/NormalizedInput';

async function createTempFile(name: string, content: string): Promise<string> {
  const target = path.join(process.cwd(), 'tmp', name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return target;
}

function baseInput(partial: Partial<NormalizedInput>): NormalizedInput {
  return {
    actorId: 'telegram:1',
    channel: 'telegram',
    channelRef: { channel: 'telegram', ref: { chatId: 1, messageId: 1 } },
    inputType: 'text',
    text: '',
    attachments: [],
    requiresAudioReply: false,
    receivedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('MediaPreprocessor', () => {
  it('extracts and normalizes markdown document text', async () => {
    const mdPath = await createTempFile(
      'media-preprocessor-doc.md',
      '# Titulo\n\nTexto **importante** com `codigo`.\n',
    );

    const preprocessor = new MediaPreprocessor({
      maxAudioBytes: 20 * 1024 * 1024,
      maxAudioDurationSeconds: 600,
      sttTimeoutMs: 5000,
      allowedRoots: ['./tmp'],
    });

    const result = await preprocessor.preprocess(
      baseInput({
        inputType: 'file',
        attachments: [{ filePath: mdPath, mimeType: 'text/markdown' }],
      }),
    );

    expect(result.text).toContain('[document]');
    expect(result.text).toContain('Titulo');
  });

  it('transcribes supported audio using SpeechToText service', async () => {
    const audioPath = await createTempFile('media-preprocessor-audio.ogg', 'audio-binary-placeholder');
    const stt: SpeechToTextPort = {
      transcribe: async () => ({
        text: 'transcricao de teste',
        metadata: { provider: 'mock' },
      }),
    };

    const preprocessor = new MediaPreprocessor(
      {
        maxAudioBytes: 20 * 1024 * 1024,
        maxAudioDurationSeconds: 600,
        sttTimeoutMs: 5000,
        allowedRoots: ['./tmp'],
      },
      { speechToText: stt },
    );

    const result = await preprocessor.preprocess(
      baseInput({
        inputType: 'audio',
        attachments: [
          {
            filePath: audioPath,
            mimeType: 'audio/ogg',
            sizeBytes: 100,
            durationSeconds: 5,
          },
        ],
      }),
    );

    expect(result.text).toContain('[transcript]');
    expect(result.text).toContain('transcricao de teste');
  });
});
