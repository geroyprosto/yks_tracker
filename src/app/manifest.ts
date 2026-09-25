import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {name:'YKSim · Kişisel YKS takibi',short_name:'YKSim',description:'Kendi ritminde, hedefe doğru.',lang:'tr',start_url:'/',scope:'/',display:'standalone',background_color:'#101b2c',theme_color:'#101b2c',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon-maskable.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]}}

