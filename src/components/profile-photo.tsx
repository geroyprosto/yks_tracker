'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { PROFILE_PHOTO_TYPES, profilePhotoError } from '@/lib/profile-photo';
import { Card } from './primitives';
import styles from './profile-photo.module.css';

export function useProfilePhoto(authenticated: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const replace = useCallback((photo: Blob | null) => {
    generation.current++;
    const next = photo ? URL.createObjectURL(photo) : null;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = next;
    setUrl(next);
    setLoading(false);
    setError('');
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++generation.current;
    try {
      const response = await fetch('/api/profile/photo', { cache: 'no-store', signal });
      if (!response.ok && response.status !== 404) throw new Error('Fotoğraf yüklenemedi. Yeniden deneyebilirsin.');
      const photo = response.ok ? await response.blob() : null;
      if (!signal?.aborted && request === generation.current) replace(photo);
    } catch (failure) {
      if (!signal?.aborted && request === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Fotoğraf yüklenemedi.');
        setLoading(false);
      }
    }
  }, [replace]);
  const release = useCallback(() => {
    generation.current++;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    // State changes in load happen only after the HTTP response (or failure).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => {
      controller.abort();
      release();
    };
  }, [authenticated, load, release]);
  return { url: authenticated ? url : null, loading: authenticated && loading, error, replace, reload: () => {
    setLoading(true); setError(''); return load();
  } };
}

export type ProfilePhotoState = ReturnType<typeof useProfilePhoto>;

export function ProfileAvatar({ url, initials, small = false }: { url: string | null; initials: string; small?: boolean }) {
  return <span className={'avatar ' + styles.avatar + (small ? ' small' : '')} aria-hidden="true">
    {url ? <Image src={url} alt="" width={small ? 30 : 37} height={small ? 30 : 37} unoptimized /> : initials}
  </span>;
}

export function ProfilePhotoSettings({ photo, authenticated, name }: { photo: ProfilePhotoState; authenticated: boolean; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);

  async function save(remove = false) {
    if (saving || (!remove && !selection)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/profile/photo', remove ? { method: 'DELETE' } : {
        method: 'PUT', headers: { 'Content-Type': selection!.file.type }, body: selection!.file,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Fotoğraf kaydedilemedi. Yeniden deneyebilirsin.');
      }
      photo.replace(remove ? null : selection!.file);
      setSelection(null);
      setNotice(remove ? 'Profil fotoğrafın kaldırıldı.' : 'Profil fotoğrafın kaydedildi.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Bağlantı kurulamadı. Yeniden deneyebilirsin.');
    } finally { setSaving(false); }
  }

  const initials = name.trim().split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
  const disabled = !authenticated || saving || photo.loading;
  return <Card title="Profil fotoğrafı" action={<Camera size={22} />}>
    <div className={styles.editor} aria-busy={saving || photo.loading}>
      <div className={styles.preview}>
        {selection || photo.url ? <Image src={selection?.url ?? photo.url!} alt={selection ? 'Seçilen profil fotoğrafı' : 'Profil fotoğrafın'} width={96} height={96} unoptimized /> : <span aria-label="Henüz profil fotoğrafı yok">{initials}</span>}
      </div>
      <div className={styles.details}>
        <p className="soft-copy">Çalışma alanına kendi fotoğrafını ekle.</p>
        <p id="profile-photo-help" className="footnote">JPG, PNG veya WebP · En fazla 4 MB. Fotoğrafın ortası kare olarak kullanılır ve hesabında ve katıldığın arkadaş gruplarında görünür.</p>
        <input ref={input} className={styles.fileInput} type="file" accept={PROFILE_PHOTO_TYPES.join(',')} aria-label="Profil fotoğrafı seç" aria-describedby="profile-photo-help" disabled={disabled} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setNotice('');
          const failure = profilePhotoError(file);
          setError(failure ?? '');
          if (!failure) setSelection({ file, url: URL.createObjectURL(file) });
        }} />
        <div className={styles.actions}>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => input.current?.click()}><Camera size={17} />{photo.url || selection ? 'Fotoğrafı değiştir' : 'Fotoğraf seç'}</button>
          {photo.url && !selection && <button type="button" className="button secondary" disabled={disabled} onClick={() => void save(true)}><Trash2 size={17} />Fotoğrafı kaldır</button>}
          {selection && <><button type="button" className="button primary" disabled={disabled} onClick={() => void save()}>{saving ? 'Kaydediliyor…' : 'Fotoğrafı kaydet'}</button><button type="button" className="button secondary" disabled={saving} onClick={() => { setSelection(null); setError(''); }}>Vazgeç</button></>}
        </div>
        {selection && <p className="footnote">Önizleme hazır. Fotoğrafını kullanmak için kaydet.</p>}
        {!authenticated && <p className="footnote">Fotoğraf eklemek için hesabına giriş yap.</p>}
        {photo.loading && <p role="status" className="footnote">Fotoğraf yükleniyor…</p>}
        {photo.error && <p role="alert" className="notice error">{photo.error} <button type="button" className="text-button" disabled={saving} onClick={() => void photo.reload()}>Yeniden dene</button></p>}
        {error && <p role="alert" className="notice error">{error}</p>}
        {notice && <p role="status" className="notice">{notice}</p>}
      </div>
    </div>
  </Card>;
}
