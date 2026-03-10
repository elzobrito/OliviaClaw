export type TtsTargetFormat = 'mp3' | 'wav' | 'ogg';

export interface TextToSpeechInput {
  text: string;
  voiceId?: string;
  timeoutMs: number;
  maxChars: number;
  targetFormat?: TtsTargetFormat;
}

export interface TextToSpeechResult {
  filePath: string;
  mimeType: string;
  durationSeconds?: number;
  metadata: {
    provider?: string;
    requestId?: string;
    model?: string;
    voiceId?: string;
  };
}

export interface TextToSpeechError {
  code:
    | 'TTS_TIMEOUT'
    | 'TTS_EXECUTION_FAILED'
    | 'TTS_VALIDATION_ERROR'
    | 'TTS_UNSUPPORTED_FORMAT'
    | 'TTS_INPUT_TOO_LONG';
  message: string;
  retriable: boolean;
}

export interface TextToSpeechPort {
  synthesize(input: TextToSpeechInput): Promise<TextToSpeechResult>;
}
