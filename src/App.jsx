import { AppProvider, useApp } from './context/AppContext'
import NavBar from './components/NavBar'
import ApiBar from './components/ApiBar'
import ScriptGenTab from './tabs/ScriptGenTab'
import StudioTab from './tabs/StudioTab'
import TTSTab from './tabs/TTSTab'
import VoiceTab from './tabs/VoiceTab'
import ExtractTab from './tabs/ExtractTab'
import VideoTab from './tabs/VideoTab'
import ThumbnailTab from './tabs/ThumbnailTab'
import DashboardTab from './tabs/DashboardTab'
import RetentionHookTab from './tabs/RetentionHookTab'
import EditMetaTab from './tabs/EditMetaTab'
import s from './App.module.css'

const TAB_MAP = {
    script: ScriptGenTab,
    studio: StudioTab,
    tts: TTSTab,
    voice: VoiceTab,
    extract: ExtractTab,
    video: VideoTab,
    thumbnail: ThumbnailTab,
    dashboard: DashboardTab,
    retention: RetentionHookTab,
    editmeta: EditMetaTab,
}

function Layout() {
    const { state } = useApp()
    const Tab = TAB_MAP[state.activeTab] || ScriptGenTab
    return (
          <div className={s.app}>
                  <NavBar />
                  <ApiBar />
                  <div className={s.content}>
                            <Tab />
                  </div>
          </div>
        )
}

export default function App() {
    return (
          <AppProvider>
                <Layout />
          </AppProvider>
        )
