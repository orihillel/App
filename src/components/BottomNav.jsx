import React from 'react';
import { Home, Map, Bell, User } from 'lucide-react';
import { COLORS } from '../lib/colors.js';

export function BottomNav({ view, handleNav }) {
  return (
    <div className="flex justify-around items-center" style={{ marginTop: 18, padding: '14px 20px 20px', borderTop: '1px solid ' + COLORS.foamFaint }}>
      <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('home')} aria-label="Home"><Home size={20} color={view === 'home' ? COLORS.coral : COLORS.foamDim} /></button>
      <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('map')} aria-label="Globe"><Map size={20} color={view === 'globe' ? COLORS.coral : COLORS.foamDim} /></button>
      <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('alerts')} aria-label="Alerts"><Bell size={20} color={view === 'alerts' ? COLORS.coral : COLORS.foamDim} /></button>
      <button className="tl-btn" style={{ background: 'none', border: 'none', padding: 6 }} onClick={() => handleNav('profile')} aria-label="Profile"><User size={20} color={view === 'profile' ? COLORS.coral : COLORS.foamDim} /></button>
    </div>
  );
}
