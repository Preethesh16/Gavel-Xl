import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const VolumeIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="M5 9v6h4l5 4V5L9 9H5Z" />
    <path d="M17 9.5a4 4 0 0 1 0 5" />
  </IconFrame>
);
export const MuteIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="M5 9v6h4l5 4V5L9 9H5Z" />
    <path d="m17 10 4 4m0-4-4 4" />
  </IconFrame>
);
export const CopyIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </IconFrame>
);
export const TeamIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M16.5 14a5 5 0 0 1 4 5" />
  </IconFrame>
);
export const ArrowIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m5 12 14 0m-5-5 5 5-5 5" />
  </IconFrame>
);
export const CloseIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m5 5 14 14M19 5 5 19" />
  </IconFrame>
);
export const ChevronIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m8 10 4 4 4-4" />
  </IconFrame>
);
export const CrownIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m4 18-1-10 5 4 4-7 4 7 5-4-1 10H4Z" />
    <path d="M4 21h16" />
  </IconFrame>
);
export const SignalIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="M5 16.5a10 10 0 0 1 14 0M8 13a6 6 0 0 1 8 0M11 9.5a2 2 0 0 1 2 0" />
    <circle cx="12" cy="19" r=".8" fill="currentColor" stroke="none" />
  </IconFrame>
);
export const GavelIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m14.5 5.5 4 4M6 14l4 4M8 16l8.5-8.5M4 20h11M13 4l6 6" />
  </IconFrame>
);
export const ShareIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="m8.2 10.8 7.5-4.5m-7.5 6.9 7.5 4.5" />
  </IconFrame>
);
export const SearchIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </IconFrame>
);
export const ReplayIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="M4 8V3m0 0h5M4 3l4 4a8 8 0 1 1-2.3 8" />
  </IconFrame>
);
export const CheckIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="m5 12 4 4L19 6" />
  </IconFrame>
);
export const EyeIcon = (props: IconProps) => (
  <IconFrame {...props}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  </IconFrame>
);
