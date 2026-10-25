import React, { useState, useEffect, useRef } from 'react';
import FavoritesView from './FavoritesView';
import { Globe, RefreshCw, Heart, MousePointerClick, Star, Play, Loader2, User, Search, X } from 'lucide-react';
import { NodeInfo, WebAppInfo, Favorite, HomeDefaultTab } from '../types';
import { getOfficialAppList, AppListItem } from '../services/api';
import {
    getPreferredRunningHubRegion,
    getRunningHubHost,
    RUNNING_HUB_REGION_CHANGE_EVENT,
} from '../services/runningHubRegion';

interface HomeViewProps {
    onSelectApp: (appId: string, preloadedData?: { nodes: NodeInfo[], appInfo: WebAppInfo }) => void;
    favorites: Favorite[];
    apiKeys: string[];
    onUpdateFavorites: (favorites: Favorite[]) => void;
    onToggleFavorite: (app: Favorite) => void;
    defaultTab: HomeDefaultTab;
    resetToken: number;
}

const HomeView: React.FC<HomeViewProps> = ({ onSelectApp, favorites, apiKeys, onUpdateFavorites, onToggleFavorite, defaultTab, resetToken }) => {
    const [activeTab, setActiveTab] = useState<HomeDefaultTab>(defaultTab);

    const [directAppInput, setDirectAppInput] = useState('');
    const [curatedOnly, setCuratedOnly] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const requestVersion = useRef(0);
    const submittedKeyword = useRef('');
    const openDirectApp = () => {
        if (directAppInput.trim()) onSelectApp(directAppInput.trim());
    };

    // Official apps state
    const [officialApps, setOfficialApps] = useState<AppListItem[]>([]);
    const [isLoadingOfficial, setIsLoadingOfficial] = useState(false);

    const [sortOrder, setSortOrder] = useState<string>('RECOMMEND');
    const [searchKeyword, setSearchKeyword] = useState('');

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [totalApps, setTotalApps] = useState(0);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [regionRevision, setRegionRevision] = useState(0);

    useEffect(() => {
        const handleRegionChange = () => setRegionRevision(value => value + 1);
        window.addEventListener(RUNNING_HUB_REGION_CHANGE_EVENT, handleRegionChange);
        return () => window.removeEventListener(RUNNING_HUB_REGION_CHANGE_EVENT, handleRegionChange);
    }, []);

    useEffect(() => {
        if (activeTab === 'official') {
            loadOfficialApps(true);
        }
    }, [activeTab, sortOrder, regionRevision, curatedOnly]);


    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab, resetToken]);

    const loadOfficialApps = async (reset = false, keywordOverride?: string, forceRefresh = false) => {
        const version = reset ? ++requestVersion.current : requestVersion.current;
        const region = getPreferredRunningHubRegion();
        const pageToLoad = reset ? 1 : currentPage + 1;
        const currentKeyword = keywordOverride !== undefined ? keywordOverride : (reset ? searchKeyword : submittedKeyword.current);
        if (reset) submittedKeyword.current = currentKeyword;
        setLoadError(null);
        const isDefaultFetch = reset && currentKeyword === '' && sortOrder === 'RECOMMEND';

        if (reset) {
            setIsLoadingOfficial(true);
            setIsLoadingMore(false);
        } else {
            setIsLoadingMore(true);
        }

        try {
            if (isDefaultFetch && !forceRefresh && localStorage.getItem('rh_refresh_store_startup') === 'false') {
                try {
                    const cacheKey = `rh_official_apps_cache_v2_${region}_${curatedOnly ? 'curated' : 'all'}`;
                    const cached = localStorage.getItem(cacheKey);
                    if (cached) {
                        const parsedCache = JSON.parse(cached);
                        if (parsedCache?.records?.length > 0) {
                            setOfficialApps(parsedCache.records);
                            setCurrentPage(1);
                            setTotalApps(parsedCache.total);
                            setIsLoadingOfficial(false);
                            return;
                        }
                    }
                } catch (e) {}
            }

            const res = await getOfficialAppList(pageToLoad, 50, sortOrder, currentKeyword, curatedOnly);
            if (version !== requestVersion.current) return;

            if (reset) {
                setOfficialApps(res.records);
                setCurrentPage(1);
                if (isDefaultFetch) {
                    const cacheKey = `rh_official_apps_cache_v2_${region}_${curatedOnly ? 'curated' : 'all'}`;
                    localStorage.setItem(cacheKey, JSON.stringify({ records: res.records, total: res.total }));
                }
            } else {
                setOfficialApps(prev => [...new Map([...prev, ...res.records].map(app => [app.id, app])).values()]);
                setCurrentPage(pageToLoad);
            }

            setTotalApps(res.total);
        } catch (e) {
            if (version === requestVersion.current) setLoadError(e instanceof Error ? e.message : "应用列表加载失败，请重试");
        } finally {
            if (version !== requestVersion.current) return;
            if (reset) {
                setIsLoadingOfficial(false);
            } else {
                setIsLoadingMore(false);
            }
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0F1115] overflow-auto p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#161920]">
                <span className="text-sm font-medium">通过 ID / 链接打开应用</span>
                <input value={directAppInput} onChange={event => setDirectAppInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') openDirectApp(); }}
                    aria-label="应用 ID 或链接" placeholder="粘贴 RunningHub 应用 ID 或详情页链接"
                    className="min-w-48 flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
                <button onClick={openDirectApp} disabled={!directAppInput.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">添加到多任务</button>
            </div>
            {loadError && activeTab === 'official' && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{loadError}</div>}
            <div className="flex items-center justify-between mb-6 border-b border-slate-200 dark:border-slate-800 pb-2 shrink-0">
                <div className="flex gap-6">
                    <button
                        onClick={() => setActiveTab('favorites')}
                        className={`pb-2 text-sm font-semibold transition-colors border-b-2 -mb-2.5 px-1 ${activeTab === 'favorites'
                            ? 'text-brand-600 dark:text-brand-400 border-brand-600 dark:border-brand-400'
                            : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                    >
                        我的收藏
                    </button>
                    <button
                        onClick={() => setActiveTab('official')}
                        className={`pb-2 text-sm font-semibold transition-colors border-b-2 -mb-2.5 px-1 ${activeTab === 'official'
                            ? 'text-brand-600 dark:text-brand-400 border-brand-600 dark:border-brand-400'
                            : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                    >
                        官方应用商城
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    {activeTab === 'official' && (
                        <>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                                    <Search className="h-3.5 w-3.5" />
                                </div>
                                <input
                                    type="text"
                                    value={searchKeyword}
                                    onChange={(e) => setSearchKeyword(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && loadOfficialApps(true)}
                                    placeholder="搜索应用..."
                                    className="block w-40 pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500 transition-all outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 group-hover:bg-slate-50 dark:group-hover:bg-slate-800"
                                />
                                {searchKeyword && (
                                    <button
                                        onClick={() => {
                                            setSearchKeyword('');
                                            loadOfficialApps(true, '');
                                        }}
                                        className="absolute inset-y-0 right-0 pr-2 flex items-center cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => loadOfficialApps(true, searchKeyword, true)}
                                className="flex items-center justify-center p-1.5 ml-2 mr-2 text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 rounded-lg transition-colors border border-brand-200 dark:border-brand-800"
                                title="手动刷新"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                            <select aria-label="应用范围" value={curatedOnly ? 'curated' : 'all'} onChange={event => setCuratedOnly(event.target.value === 'curated')}
                                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-[#1a1d24]">
                                <option value="all">全部公开应用</option><option value="curated">精选应用</option>
                            </select>
                            <select
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value)}
                                className="bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                <option value="RECOMMEND">综合推荐</option>
                                <option value="NEWEST">最新发布</option>
                                <option value="HOTTEST">热门应用</option>
                                <option value="REPUTATION">最多好评</option>
                            </select>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0">
                {activeTab === 'official' && <p className="mb-4 text-xs text-slate-500">当前站点：{getPreferredRunningHubRegion() === 'global' ? '国际站 runninghub.ai' : '国内站 runninghub.cn'} · 已加载 {officialApps.length} / {totalApps} 个应用。列表以站点接口返回为准；未找到时可直接输入 ID 或链接。</p>}
                {activeTab === 'official' ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 pb-10">
                        {isLoadingOfficial ? (
                            <div className="col-span-full flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
                                <Loader2 className="w-8 h-8 animate-spin" />
                                <span>加载中...</span>
                            </div>
                        ) : (
                            <>
                                {officialApps.map((app) => (
                                    <div
                                        key={app.id}
                                        className="group relative flex flex-col bg-white dark:bg-[#1a1d24] rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-300 overflow-hidden"
                                    >
                                        {/* Card Image Area - 3:4 Aspect Ratio */}
                                        <div className="relative aspect-[3/4] bg-slate-100 dark:bg-[#252830] overflow-hidden">
                                            {app.covers?.[0]?.thumbnailUri ? (
                                                <img
                                                    src={app.covers[0].thumbnailUri}
                                                    alt={app.name}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                                    <Globe className="w-8 h-8 opacity-20" />
                                                </div>
                                            )}

                                            {/* Author Badge (Top Left) */}
                                            {app.owner && (
                                                <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-md flex items-center gap-1 z-10">
                                                    <User className="w-2.5 h-2.5 text-brand-400" />
                                                    <span className="text-[10px] font-medium text-white/90">{app.owner.name}</span>
                                                </div>
                                            )}

                                            {/* Favorite Button (Top Right) */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // For official apps, currently we don't have full node info details cached from list
                                                    // But we can still favorite it. It will fetch details when clicked/loaded if needed.
                                                    // Or better, fetch details now?
                                                    // The existing fav logic expects WebAppInfo and optionally nodes.
                                                    // The app list item has minimal info.
                                                    // Let's toggle without details, it might miss some info but id/name is there.
                                                    onToggleFavorite({
                                                        webappId: app.id,
                                                        name: app.name,
                                                        upName: app.owner?.name || 'Official',
                                                        // We pass part of what we have. API type mismatch might occur if strict.
                                                        // Using 'as any' or mapping carefully.
                                                        appInfo: {
                                                            webappName: app.name,
                                                            description: app.intro || '',
                                                            covers: app.covers?.map(c => ({
                                                                thumbnailUri: c.thumbnailUri,
                                                                uri: c.fileUri || c.thumbnailUri
                                                            })),
                                                            statisticsInfo: {
                                                                likeCount: String(app.statisticsInfo?.likeCount || 0),
                                                                useCount: String(app.statisticsInfo?.useCount || 0),
                                                                collectCount: String(app.statisticsInfo?.collectCount || 0),
                                                                downloadCount: '0'
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/50 transition-colors z-10 group/fav"
                                            >
                                                <Star
                                                    className={`w-4 h-4 transition-colors ${favorites.some(f => f.webappId === app.id)
                                                        ? 'fill-amber-400 text-amber-400'
                                                        : 'text-white group-hover/fav:text-amber-400'
                                                        }`}
                                                />
                                            </button>

                                            {/* Overlay Gradient */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />

                                            {/* Instant Use Button */}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                                <button
                                                    onClick={() => onSelectApp(app.id)}
                                                    className="flex items-center gap-1 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform"
                                                >
                                                    <Play className="w-3.5 h-3.5 fill-current" />
                                                    立即使用
                                                </button>
                                            </div>

                                            {/* Info Overlay */}
                                            <div className="absolute bottom-0 left-0 right-0 p-3 pt-8 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-1">
                                                <h4
                                                    className="font-bold text-white text-xs line-clamp-2 leading-relaxed"
                                                    title={app.name}
                                                >
                                                    {app.name}
                                                </h4>

                                                <div className="flex items-center justify-between text-[10px] text-slate-300">
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex items-center gap-0.5" title="使用次数">
                                                            <MousePointerClick className="w-3 h-3 text-brand-400" />
                                                            {app.statisticsInfo?.useCount || 0}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex items-center gap-0.5" title="喜欢">
                                                            <Heart className="w-3 h-3 text-red-400" />
                                                            {app.statisticsInfo?.likeCount || 0}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {officialApps.length === 0 && (
                                    <div className="col-span-full text-sm text-slate-400 italic">暂无推荐</div>
                                )}

                                {officialApps.length > 0 && officialApps.length < totalApps && (
                                    <div className="col-span-full flex justify-center py-6">
                                        <button
                                            onClick={() => loadOfficialApps(false)}
                                            disabled={isLoadingMore}
                                            className="px-6 py-2 bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-full text-sm text-slate-600 dark:text-slate-300 hover:border-brand-500 hover:text-brand-500 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isLoadingMore ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span>加载中...</span>
                                                </>
                                            ) : (
                                                <span>加载更多</span>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    <FavoritesView favorites={favorites} apiKeys={apiKeys} onUpdateFavorites={onUpdateFavorites}
                        onSelectApp={fav => onSelectApp(fav.webappId, fav.appInfo && fav.nodes?.length ? { nodes: fav.nodes, appInfo: fav.appInfo } : undefined)} />
                )}
            </div>
        </div>
    );
};

export default HomeView;
