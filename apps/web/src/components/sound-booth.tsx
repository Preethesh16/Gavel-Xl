'use client';

import { useEffect, useRef } from 'react';
import type { CommentaryVoice } from '@/lib/neural-commentary';
import { MuteIcon, VolumeIcon } from './icons';

export interface SoundBoothProps {
  soundEnabled: boolean;
  soundAvailable: boolean;
  voiceEnabled: boolean;
  voiceSupported: boolean;
  commentator: CommentaryVoice;
  voiceStatus: string;
  voiceLoading: boolean;
  neuralReady: boolean;
  onCommentatorChange: (voice: CommentaryVoice) => void;
  onVoicePreview: () => void;
  speaking: boolean;
  volume: number;
  onSoundToggle: () => void;
  onVoiceToggle: () => void;
  onVolumeChange: (volume: number) => void;
}

export function SoundBooth({
  soundEnabled,
  soundAvailable,
  voiceEnabled,
  voiceSupported,
  commentator,
  voiceStatus,
  voiceLoading,
  neuralReady,
  onCommentatorChange,
  onVoicePreview,
  speaking,
  volume,
  onSoundToggle,
  onVoiceToggle,
  onVolumeChange,
}: SoundBoothProps) {
  const audioPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !audioPanel.current?.contains(event.target)) {
        audioPanel.current?.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && audioPanel.current?.open) {
        audioPanel.current.removeAttribute('open');
        audioPanel.current.querySelector('summary')?.focus();
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div className="broadcast-audio" data-speaking={speaking ? 'true' : 'false'}>
      <button
        className="icon-button"
        data-testid="sound-toggle"
        type="button"
        onClick={onSoundToggle}
        disabled={!soundAvailable}
        aria-label={
          !soundAvailable
            ? 'Sound disabled by the host'
            : soundEnabled
              ? 'Mute sound'
              : 'Enable sound'
        }
        aria-pressed={soundEnabled}
        title={!soundAvailable ? 'Sound is disabled in room settings' : 'Toggle all audio · M'}
      >
        {soundEnabled ? <VolumeIcon /> : <MuteIcon />}
      </button>
      <details className="broadcast-audio__settings" ref={audioPanel}>
        <summary aria-label="Broadcast audio settings" data-testid="audio-settings-toggle">
          <span className="broadcast-audio__meter" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </summary>
        <div className="broadcast-audio__panel" role="group" aria-label="Broadcast audio mix">
          <div className="broadcast-audio__heading">
            <span>THE SOUND BOOTH</span>
            <i aria-hidden="true" />
          </div>
          <p>Your seat. Your mix.</p>
          <button
            className="broadcast-audio__voice"
            type="button"
            onClick={onVoiceToggle}
            disabled={!soundAvailable || !soundEnabled}
            data-testid="voice-toggle"
            aria-label={voiceEnabled ? 'Disable commentary' : 'Enable commentary'}
            aria-pressed={voiceEnabled}
          >
            <span>
              <b>Match commentary</b>
              <small>
                {voiceSupported
                  ? 'Player reveals · analysis · the champion'
                  : 'Recorded calls only · device speech unavailable'}
              </small>
            </span>
            <strong>{voiceEnabled ? 'ON' : 'OFF'}</strong>
          </button>
          <div className="broadcast-audio__commentator">
            <label htmlFor="commentator-voice">COMMENTATOR</label>
            <select
              id="commentator-voice"
              aria-label="Commentator voice"
              value={commentator}
              disabled={!soundAvailable || !soundEnabled || !voiceEnabled}
              onChange={(event) => onCommentatorChange(event.target.value as CommentaryVoice)}
            >
              <option value="af_heart">Heart · natural American</option>
              <option value="bf_emma">Emma · natural British</option>
              <option value="device">Browser / device voice</option>
            </select>
            <small role="status" data-testid="commentator-status">
              {voiceStatus}
            </small>
            {commentator !== 'device' && !neuralReady ? (
              <small>First use downloads about 120 MB, then caches it in this browser.</small>
            ) : null}
            <button
              type="button"
              data-testid="voice-preview"
              onClick={onVoicePreview}
              disabled={!soundAvailable || !soundEnabled || !voiceEnabled || voiceLoading}
            >
              {voiceLoading
                ? 'LOADING VOICE…'
                : commentator !== 'device' && !neuralReady
                  ? 'LOAD NATURAL VOICE'
                  : 'PREVIEW VOICE'}
            </button>
          </div>
          <label className="broadcast-audio__volume">
            <span>
              MASTER VOLUME <output>{Math.round(volume * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(volume * 100)}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
              aria-label="Master volume"
              disabled={!soundAvailable || !soundEnabled}
            />
          </label>
          <footer>
            {!soundAvailable
              ? 'HOST HAS DISABLED ROOM AUDIO'
              : !soundEnabled
                ? 'ALL AUDIO MUTED'
                : speaking
                  ? 'COMMENTATOR ON AIR'
                  : 'STADIUM MIX READY'}
            <span aria-hidden="true">◉</span>
          </footer>
        </div>
      </details>
    </div>
  );
}
