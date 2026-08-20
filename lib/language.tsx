import React,{createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import * as SecureStore from 'expo-secure-store';
import { mobileCopy, type MobileLanguage } from './mobile-copy';
type Language=MobileLanguage;
const LANGUAGE_KEY='songdee.language';
const strings=mobileCopy;
type Translations=typeof strings[Language];
const Context=createContext<{language:Language;setLanguage:(v:Language)=>void;t:Translations}>({language:'en',setLanguage:()=>{},t:strings.en});
export function LanguageProvider({children}:{children:React.ReactNode}){
  const [language,setLanguageState]=useState<Language>('en');
  useEffect(()=>{let active=true;SecureStore.getItemAsync(LANGUAGE_KEY).then(saved=>{if(active&&(saved==='en'||saved==='th'))setLanguageState(saved)}).catch(()=>{});return()=>{active=false}},[]);
  const setLanguage=useCallback((next:Language)=>{setLanguageState(next);void SecureStore.setItemAsync(LANGUAGE_KEY,next).catch(()=>{})},[]);
  const value=useMemo(()=>({language,setLanguage,t:strings[language]}),[language,setLanguage]);
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useLanguage(){return useContext(Context)}
