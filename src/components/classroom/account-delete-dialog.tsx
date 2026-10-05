'use client';

import { useEffect, useRef, useState } from 'react';
import { UserMinus } from 'lucide-react';
import { roleLabel, type Account, type Command } from './api';
import styles from './classroom.module.css';
import dialogStyles from './account-delete-dialog.module.css';

export function AccountDeleteDialog({ account, command, busy, error, onCancel, onDeleted }: {
  account: Account;
  command: Command;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const cancel = () => {
    if (!submittingRef.current) onCancel();
  };

  return <dialog ref={dialogRef} className={dialogStyles.dialog} aria-labelledby="account-delete-title" aria-describedby="account-delete-description" onCancel={event => { event.preventDefault(); cancel(); }}>
    <form aria-busy={deleting} onSubmit={async event => {
      event.preventDefault();
      if (submittingRef.current || busy || confirmationEmail !== account.email) return;
      submittingRef.current = true;
      setDeleting(true);
      setFailed(false);
      try {
        if (await command('account.delete', { id: account.id, confirmation_email: confirmationEmail })) onDeleted();
        else setFailed(true);
      } finally {
        submittingRef.current = false;
        setDeleting(false);
      }
    }}>
      <p className={styles.eyebrow}>KALICI HESAP SİLME</p>
      <h2 id="account-delete-title">Kişiyi ve tüm verilerini sil</h2>
      <div className={dialogStyles.identity}><strong>{account.name}</strong><span>{account.email}</span><small>{roleLabel[account.role]}</small></div>
      <p id="account-delete-description">Bu kişinin hesabı, giriş erişimi ve veritabanındaki tüm kişisel verileri kalıcı olarak silinir. Çalışma ve deneme kayıtları, planları, yapay zekâ verileri, mesajları ve bağlantıları da silinir. Bu işlem geri alınamaz.</p>
      {account.role === 'teacher' && <p className={dialogStyles.teacherNote}>Öğretmenin öğrencileri sınıftan ayrılır; öğrencilerin kendi hesapları ve çalışma kayıtları korunur.</p>}
      <label className={dialogStyles.confirmation} htmlFor="account-delete-email">Onaylamak için kişinin e-posta adresini aynen yaz:
        <strong>{account.email}</strong>
        <input id="account-delete-email" type="text" value={confirmationEmail} onChange={event => setConfirmationEmail(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={deleting} required aria-describedby="account-delete-description" />
      </label>
      {failed && <p role="alert" className={styles.removeError}>{error || 'Kişi silinemedi. Lütfen tekrar dene.'}</p>}
      <div className={`${styles.actions} ${dialogStyles.actions}`}>
        <button ref={cancelRef} type="button" className={styles.secondaryButton} disabled={deleting} onClick={cancel}>Vazgeç</button>
        <button type="submit" className={styles.dangerButton} disabled={busy || deleting || confirmationEmail !== account.email}><UserMinus size={16} aria-hidden="true" />{deleting ? 'Siliniyor…' : 'Kişiyi ve tüm verilerini kalıcı sil'}</button>
      </div>
    </form>
  </dialog>;
}
