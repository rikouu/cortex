import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Stats from './pages/Stats.js';
import MemoryBrowser from './pages/MemoryBrowser.js';
import SearchDebug from './pages/SearchDebug.js';
import RelationGraph from './pages/RelationGraph.js';
import LifecycleMonitor from './pages/LifecycleMonitor.js';
import Settings from './pages/Settings.js';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">🧠 <span>Cortex</span></div>
          <nav>
            <NavLink to="/" end className={({isActive}) => isActive ? 'active' : ''}>📊 Dashboard</NavLink>
            <NavLink to="/memories" className={({isActive}) => isActive ? 'active' : ''}>🗂️ Memories</NavLink>
            <NavLink to="/search" className={({isActive}) => isActive ? 'active' : ''}>🔍 Search</NavLink>
            <NavLink to="/relations" className={({isActive}) => isActive ? 'active' : ''}>🕸️ Relations</NavLink>
            <NavLink to="/lifecycle" className={({isActive}) => isActive ? 'active' : ''}>♻️ Lifecycle</NavLink>
            <NavLink to="/settings" className={({isActive}) => isActive ? 'active' : ''}>⚙️ Settings</NavLink>
          </nav>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Stats />} />
            <Route path="/memories" element={<MemoryBrowser />} />
            <Route path="/search" element={<SearchDebug />} />
            <Route path="/relations" element={<RelationGraph />} />
            <Route path="/lifecycle" element={<LifecycleMonitor />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
