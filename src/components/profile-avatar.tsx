export function ProfileAvatar({ initials, small = false }: { initials: string; small?: boolean }) {
  return <span className={'avatar' + (small ? ' small' : '')} style={{ flexShrink: 0 }} aria-hidden="true">{initials}</span>;
}
