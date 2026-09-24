"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { sampleVideos } from "@/lib/demo";
import { videoRepository, storageError } from "@/lib/storage";
import type { ReviewStatus, VideoRecord } from "@/lib/types";
type Context = { videos: VideoRecord[]; loading:boolean; error:string; theme:"light"|"dark"; alerts:boolean; toast:string; setTheme:(v:"light"|"dark")=>void; setAlerts:(v:boolean)=>void; notify:(v:string)=>void; saveVideo:(v:VideoRecord)=>Promise<void>; deleteVideo:(id:string)=>Promise<void>; setReviewStatus:(videoId:string,eventId:string,status:ReviewStatus)=>Promise<void>; clearError:()=>void };
const AppContext=createContext<Context|null>(null);
const hiddenKey="kryptonxwatch-hidden-samples";
function hiddenSamples(){try{return JSON.parse(localStorage.getItem(hiddenKey)||"[]") as string[]}catch{return []}}
export function AppProvider({children}:{children:React.ReactNode}){
 const [videos,setVideos]=useState<VideoRecord[]>(sampleVideos); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [theme,setThemeState]=useState<"light"|"dark">("light"); const [alerts,setAlertsState]=useState(true); const [toast,setToast]=useState("");
 useEffect(()=>{setThemeState(localStorage.getItem("kryptonxwatch-theme")==="dark"?"dark":"light");setAlertsState(localStorage.getItem("kryptonxwatch-alerts")!=="false");videoRepository.list().then(stored=>{const hidden=hiddenSamples();setVideos([...sampleVideos.filter(v=>!hidden.includes(v.id)).map(v=>stored.find(s=>s.id===v.id)??v),...stored.filter(v=>v.source==="upload")]);}).catch(e=>setError(storageError(e))).finally(()=>setLoading(false));},[]);
 useEffect(()=>{document.documentElement.setAttribute("data-theme",theme);localStorage.setItem("kryptonxwatch-theme",theme);},[theme]);
 useEffect(()=>{localStorage.setItem("kryptonxwatch-alerts",String(alerts));},[alerts]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),5000);return()=>clearTimeout(t);},[toast]);
 const notify=useCallback((value:string)=>setToast(value),[]);
 const saveVideo=useCallback(async(v:VideoRecord)=>{try{await videoRepository.save(v);setVideos(current=>{const without=current.filter(x=>x.id!==v.id);return [...without,v].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));});setError("");}catch(e){const msg=storageError(e);setError(msg);throw new Error(msg);}},[]);
 const deleteVideo=useCallback(async(id:string)=>{const target=videos.find(v=>v.id===id);if(!target)return;try{await videoRepository.remove(id);if(target.source==="sample"){const hidden=[...new Set([...hiddenSamples(),id])];localStorage.setItem(hiddenKey,JSON.stringify(hidden));}setVideos(current=>current.filter(v=>v.id!==id));setError("");}catch(e){const msg=storageError(e);setError(msg);throw new Error(msg);}},[videos]);
 const setReviewStatus=useCallback(async(videoId:string,eventId:string,status:ReviewStatus)=>{const v=videos.find(x=>x.id===videoId);if(!v)return;await saveVideo({...v,detections:v.detections.map(d=>d.id===eventId?{...d,status}:d)});},[videos,saveVideo]);
 const value=useMemo(()=>({videos,loading,error,theme,alerts,toast,setTheme:setThemeState,setAlerts:setAlertsState,notify,saveVideo,deleteVideo,setReviewStatus,clearError:()=>setError("")}),[videos,loading,error,theme,alerts,toast,notify,saveVideo,deleteVideo,setReviewStatus]);
 return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp(){const ctx=useContext(AppContext);if(!ctx)throw new Error("AppProvider is required");return ctx;}
