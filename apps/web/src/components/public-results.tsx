'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useEffect } from 'react';
import { useSound } from '@/hooks/use-sound';
import { Brand } from './brand';
import { ResultsHub } from './results-hub';
import { SoundBooth } from './sound-booth';

export function PublicResults({ room, viewer }: { room: RoomView; viewer: RoomMemberView }) {
  const sound = useSound(room.settings.soundEnabled, null, 'off');

  useEffect(() => {
    const toggleSound = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key.toLowerCase() === 'm') sound.toggle();
    };
    window.addEventListener('keydown', toggleSound);
    return () => window.removeEventListener('keydown', toggleSound);
  }, [sound.toggle]);

  return (
    <div className="public-results">
      <header className="public-results__header">
        <Brand compact />
        <SoundBooth
          soundEnabled={sound.enabled}
          soundAvailable={sound.available}
          voiceEnabled={sound.voiceEnabled}
          voiceSupported={sound.voiceSupported}
          commentator={sound.commentator}
          voiceStatus={sound.voiceStatus}
          voiceLoading={sound.voiceLoading}
          neuralReady={sound.neuralReady}
          onCommentatorChange={sound.setCommentator}
          onVoicePreview={sound.previewVoice}
          speaking={sound.speaking}
          volume={sound.volume}
          onSoundToggle={sound.toggle}
          onVoiceToggle={sound.toggleVoice}
          onVolumeChange={sound.setVolume}
        />
        <div>
          <span>READ-ONLY RESULT</span>
          <strong>{room.code}</strong>
        </div>
      </header>
      <ResultsHub room={room} me={viewer} readOnly />
    </div>
  );
}
