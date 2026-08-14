'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import type { ConnectionState } from '@/hooks/use-gavel-room';
import { Brand } from './brand';
import { ConnectionPill } from './system-feedback';
import { CopyIcon, MuteIcon, VolumeIcon } from './icons';

interface RoomHeaderProps {
  room: RoomView;
  me: RoomMemberView;
  connection: ConnectionState;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  onCopy: () => void;
  onBack: () => void;
}

export function RoomHeader({
  room,
  me,
  connection,
  soundEnabled,
  onSoundToggle,
  onCopy,
  onBack,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <div className="room-header__home">
        <button
          type="button"
          data-testid="back-to-home"
          onClick={onBack}
          aria-label="Leave room and go back to the main screen"
        >
          <span aria-hidden="true">←</span>
          <b>HOME</b>
        </button>
        <Brand compact />
      </div>
      <div className="room-header__identity">
        <span>ROOM</span>
        <button
          type="button"
          data-testid="room-code"
          onClick={onCopy}
          aria-label={`Copy room code ${room.code}`}
        >
          {room.code}
          <CopyIcon />
        </button>
      </div>
      <div className="room-header__right">
        <span className="room-header__me" data-testid="my-name">
          <i style={{ background: me.color }} />
          {me.name}
        </span>
        <button
          className="icon-button"
          data-testid="sound-toggle"
          type="button"
          onClick={onSoundToggle}
          aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'}
        >
          {soundEnabled ? <VolumeIcon /> : <MuteIcon />}
        </button>
        <ConnectionPill state={connection} />
      </div>
    </header>
  );
}
