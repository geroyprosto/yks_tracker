import type { ReactNode } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
export function Card({title,eyebrow,action,children,className=''}:{title?:string;eyebrow?:string;action?:ReactNode;children:ReactNode;className?:string}){
 return <section className={'card '+className}>{(title||action)&&<header className="card-head"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}{title&&<h2>{title}</h2>}</div>{action}</header>}{children}</section>;
}
export function Empty({icon,title,text,action}:{icon?:ReactNode;title:string;text:string;action?:ReactNode}){
 return <div className="empty">{icon&&<div className="empty-icon">{icon}</div>}<h3>{title}</h3><p>{text}</p>{action}</div>;
}
export {Ring} from './progress-ring';
export function LinkButton({children,onClick}:{children:ReactNode;onClick:()=>void}){return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={16}/></button>}
export function AddButton({onClick,children='Görev ekle',disabled=false}:{onClick:()=>void;children?:ReactNode;disabled?:boolean}){return <button className="button primary" onClick={onClick} disabled={disabled}><Plus size={17}/>{children}</button>}

