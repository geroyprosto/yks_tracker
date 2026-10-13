import styles from './workspace.module.css';

/** Original, decorative Nova portrait; mood is always described in adjacent text. */
export function NovaAvatar({large = false}: {large?: boolean}) {
  return <span className={`${styles.avatar} ${large ? styles.avatarLarge : ''}`} aria-hidden="true">
    <svg viewBox="0 0 100 112" fill="none">
      <circle cx="50" cy="53" r="43" className={styles.avatarHalo}/>
      <path d="M15 105c2-23 17-32 35-32s34 10 36 32" className={styles.avatarShirt}/>
      <path d="M24 63C12 26 33 11 55 14c26 3 33 27 20 52L24 63Z" className={styles.avatarHair}/>
      <path d="M41 72v13c6 7 13 7 20 0V72" className={styles.avatarSkin}/>
      <path d="M27 43c-1 25 6 36 24 36s25-15 23-39c-14 5-23-1-28-10-3 8-10 12-19 13Z" className={styles.avatarSkin}/>
      <path d="M36 52c2-2 5-2 7 0m15 0c2-2 5-2 7 0" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/>
      <path d="M45 65c4 3 8 3 12-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M77 30l3-7 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" className={styles.avatarStar}/>
    </svg>
  </span>;
}
