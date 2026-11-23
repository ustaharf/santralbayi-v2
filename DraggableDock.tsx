import React, { useState, useRef, useEffect } from 'react';
import { Globe, PhoneCall } from 'lucide-react';

interface DraggableDockProps {
  onOpenPhone?: () => void;
  onOpenSendDocument?: () => void;
  onOpenQuickActions?: () => void;
  onShareApp: () => void;
  dockOrder: string[];
  onReorder: (newOrder: string[]) => void;
  className?: string;
  shareBadgeText?: string | null;
  shareBadgeComplete?: boolean;
  voipRinging?: boolean;
  voipConnected?: boolean;
  voipOnline?: boolean;
}

export const DraggableDock: React.FC<DraggableDockProps> = ({
  onOpenPhone,
  onOpenSendDocument,
  onOpenQuickActions,
  onShareApp,
  dockOrder,
  onReorder,
  className = 'mb-2',
  shareBadgeText = null,
  shareBadgeComplete = false,
  voipRinging = false,
  voipConnected = false,
  voipOnline = true,
}) => {
  const baseFiltered = dockOrder.filter((id) => id !== 'web');
  const visibleDockOrder = baseFiltered.includes('phone')
    ? baseFiltered
    : ['phone', ...baseFiltered];

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isReorderingActive, setIsReorderingActive] = useState(false);

  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasMovedRef = useRef<boolean>(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const isReorderingRef = useRef<boolean>(false);
  isReorderingRef.current = isReorderingActive;
  const dockOrderRef = useRef<string[]>(visibleDockOrder);
  dockOrderRef.current = visibleDockOrder;

  // Pointer Events (Mouse + Touch Unified)
  const handlePointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch {}
    startPosRef.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }

    holdTimerRef.current = setTimeout(() => {
      setActiveId(id);
      setIsReorderingActive(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(30);
        } catch {}
      }
    }, 250);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - startPosRef.current.x,
      e.clientY - startPosRef.current.y
    );

    if (!isReorderingRef.current) {
      if (dist > 12 && holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      return;
    }

    hasMovedRef.current = true;
    if (e.cancelable) e.preventDefault();
  };

  const handlePointerUp = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    startPosRef.current = null;
    setActiveId(null);
    setIsReorderingActive(false);
    setTimeout(() => {
      hasMovedRef.current = false;
    }, 150);
  };

  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      if (!isReorderingRef.current || !activeIdRef.current) return;
      hasMovedRef.current = true;
      const currActive = activeIdRef.current;

      const elements =
        typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(e.clientX, e.clientY)
          : ([document.elementFromPoint(e.clientX, e.clientY)].filter(Boolean) as Element[]);

      for (const el of elements) {
        const targetButton = (el as Element).closest?.('[data-dock-id]');
        if (targetButton) {
          const targetId = targetButton.getAttribute('data-dock-id');
          if (targetId && targetId !== currActive) {
            const rect = targetButton.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distToCenter = Math.hypot(e.clientX - centerX, e.clientY - centerY);

            if (distToCenter < Math.max(rect.width, rect.height) * 0.78) {
              const current = [...dockOrderRef.current];
              const dragIdx = current.indexOf(currActive);
              const targetIdx = current.indexOf(targetId);

              if (dragIdx !== -1 && targetIdx !== -1) {
                current.splice(dragIdx, 1);
                current.splice(targetIdx, 0, currActive);
                onReorder(current);
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  try {
                    navigator.vibrate(25);
                  } catch {}
                }
                break;
              }
            }
          }
        }
      }
    };

    const onWinUp = () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      startPosRef.current = null;
      setActiveId(null);
      setIsReorderingActive(false);
      setTimeout(() => {
        hasMovedRef.current = false;
      }, 150);
    };

    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    };
  }, [onReorder]);

  const handleClick = (id: string, e: React.MouseEvent) => {
    if (hasMovedRef.current || isReorderingActive) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (id === 'phone') {
      onOpenPhone?.();
    } else if (id === 'send_document') {
      onOpenSendDocument?.();
    } else if (id === 'share') {
      onShareApp();
    } else if (id === 'web') {
      const link = document.createElement('a');
      link.href = 'https://santralbayi.com';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    } else if (id === 'whatsapp' || id === 'quick_action') {
      onOpenQuickActions?.();
    }
  };

  const renderIcon = (id: string) => {
    switch (id) {
      case 'phone':
        return (
          <>
            <div
              className={`relative w-13 h-13 rounded-2xl border shadow-md flex items-center justify-center transition-all pointer-events-none ${
                voipRinging
                  ? 'bg-gradient-to-b from-emerald-500 via-emerald-600 to-teal-900 border-emerald-200 shadow-emerald-400/60 animate-bounce'
                  : voipConnected
                  ? 'bg-gradient-to-b from-emerald-800/95 via-emerald-950 to-slate-950 border-emerald-400 shadow-emerald-400/40'
                  : 'bg-gradient-to-b from-emerald-950/90 via-slate-900 to-slate-950 border-emerald-500/70 shadow-emerald-500/25 group-hover:border-emerald-400'
              }`}
            >
              <PhoneCall
                className={`w-6 h-6 pointer-events-none ${
                  voipRinging ? 'text-slate-950 animate-pulse' : 'text-emerald-300'
                }`}
              />
              {voipRinging ? (
                <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[8px] font-black leading-none bg-rose-500 text-white border border-rose-200 shadow pointer-events-none">
                  ZİL
                </span>
              ) : voipConnected ? (
                <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[8px] font-black leading-none bg-emerald-400 text-slate-950 border border-emerald-100 shadow pointer-events-none">
                  HATTA
                </span>
              ) : (
                <span
                  className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-slate-950 pointer-events-none ${
                    voipOnline ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
              )}
            </div>
            <span className="text-[10.5px] font-bold text-emerald-300 mt-1.5 text-center truncate w-full pointer-events-none">
              Telefon
            </span>
          </>
        );
      case 'send_document':
        return (
          <>
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-teal-950/80 via-slate-900 to-slate-950 border border-teal-500/60 shadow-md shadow-teal-500/20 flex items-center justify-center group-hover:border-teal-400 transition-all pointer-events-none">
              <span className="text-2xl leading-none filter drop-shadow pointer-events-none">📤</span>
            </div>
            <span className="text-[10.5px] font-bold text-slate-200 mt-1.5 text-center truncate w-full pointer-events-none">
              Belge Gönder
            </span>
          </>
        );
      case 'web':
        return (
          <>
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-slate-800/90 via-slate-900 to-slate-950 border border-slate-600/60 shadow-md flex items-center justify-center text-slate-200 group-hover:border-slate-400 transition-all pointer-events-none">
              <Globe className="w-6 h-6 text-slate-200 pointer-events-none" />
            </div>
            <span className="text-[10.5px] font-bold text-slate-200 mt-1.5 text-center truncate w-full pointer-events-none">
              Web
            </span>
          </>
        );
      case 'whatsapp':
      case 'quick_action':
        return (
          <>
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-cyan-950/80 via-slate-900 to-slate-950 border border-cyan-500/60 shadow-md shadow-cyan-500/20 flex items-center justify-center group-hover:border-cyan-400 transition-all pointer-events-none">
              <span className="text-2xl leading-none filter drop-shadow pointer-events-none">⚡</span>
            </div>
            <span className="text-[10.5px] font-bold text-cyan-300 mt-1.5 text-center truncate w-full pointer-events-none">
              Hızlı İşlem
            </span>
          </>
        );
      case 'share':
        return (
          <>
            <div className="relative w-13 h-13 rounded-2xl bg-gradient-to-b from-amber-950/80 via-slate-900 to-slate-950 border border-amber-500/60 shadow-md shadow-amber-500/20 flex items-center justify-center group-hover:border-amber-400 transition-all pointer-events-none">
              <span className="text-2xl leading-none filter drop-shadow pointer-events-none">📢</span>
              {shareBadgeText && (
                <span
                  className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-black leading-none border shadow pointer-events-none ${
                    shareBadgeComplete
                      ? 'bg-emerald-500 text-slate-950 border-emerald-200'
                      : 'bg-amber-400 text-slate-950 border-amber-100'
                  }`}
                >
                  {shareBadgeText}
                </span>
              )}
            </div>
            <span className="text-[10.5px] font-bold text-amber-300 mt-1.5 text-center truncate w-full pointer-events-none">
              Dağıt
            </span>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className={`bg-slate-950/85 px-2 py-2.5 rounded-3xl border border-slate-800/80 grid ${
          visibleDockOrder.length >= 4 ? 'grid-cols-4 gap-x-1.5' : 'grid-cols-3 gap-x-3'
        } items-center select-none touch-none shadow-lg`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {visibleDockOrder.map((id) => {
          const isBeingDragged = activeId === id && isReorderingActive;

          return (
            <div
              key={id}
              data-dock-id={id}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => handlePointerDown(id, e)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onClick={(e) => handleClick(id, e)}
              className={`relative flex flex-col items-center justify-center group transition-all select-none touch-none rounded-2xl outline-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
                isBeingDragged
                  ? 'scale-115 opacity-80 ring-2 ring-emerald-400 p-0.5 bg-emerald-950/50 z-20 shadow-xl shadow-emerald-500/30 cursor-grabbing'
                  : 'active:scale-90 cursor-pointer'
              }`}
              title="Açmak için dokunun, yerini değiştirmek için 250ms basılı tutup sürükleyin"
            >
              {renderIcon(id)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
