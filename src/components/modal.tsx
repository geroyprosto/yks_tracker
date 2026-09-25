'use client';
import {useEffect,useRef,useContext,createContext,type ReactNode} from 'react';
import {X} from 'lucide-react';
export const ModalErrorContext=createContext('');
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const error=useContext(ModalErrorContext);
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();(dialog?.querySelector<HTMLElement>('[data-initial-focus]')??dialog?.querySelector<HTMLInputElement>('input:not([type="hidden"]),select,textarea'))?.focus();return()=>{dialog?.close()}},[]);
 return <dialog ref={ref} className="modal" onCancel={onClose} aria-labelledby="modal-title"><div className="modal-head"><h2 id="modal-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Pencereyi kapat"><X size={20}/></button></div>{error&&<p className="modal-error" role="alert">{error}</p>}{children}</dialog>;
}

