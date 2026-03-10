export interface SpeechToTextInput {
  filePath: string;
  mimeType?: string;
  originalDurationSeconds?: number;
  languageHint?: string;
  timeoutMs: number;
}

export interface SpeechToTextResult {
  text: string;
  language?: string;
  durationSeconds?: number;
  metadata: {
    provider?: string;
    requestId?: string;
    model?: string;
  };
}

export interface SpeechToTextError {
  code: 'STT_TIMEOUT' | 'STT_EXECUTION_FAILED' | 'STT_UNSUPPORTED_MEDIA' | 'STT_VALIDATION_ERROR';
  message: string;
  retriable: boolean;
}

export interface SpeechToTextPort {
  transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult>;
}
