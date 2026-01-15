import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import Leaderboard from './components/Leaderboard'
import Analytics from './components/Analytics'
import History from './components/History'
import LocationMap from './components/LocationMap'
import { WasteItem, ScanHistoryEntry, Screen, BinInfo } from './types'

// Energy savings data (kWh per kg)
const ENERGY_SAVINGS: Record<string, number> = {
  'aluminum': 14.0,
  'plastic': 5.6,
  'glass': 0.3,
  'paper': 4.1,
  'cardboard': 4.1,
  'steel': 1.4,
  'organic': 0.5,
  'default': 2.0
};

const calculateEnergySaved = (itemName: string): number => {
  const name = itemName.toLowerCase();
  if (name.includes('aluminum') || name.includes('aluminium') || name.includes('can')) return ENERGY_SAVINGS.aluminum;
  if (name.includes('plastic') || name.includes('bottle') || name.includes('pet')) return ENERGY_SAVINGS.plastic;
  if (name.includes('glass')) return ENERGY_SAVINGS.glass;
  if (name.includes('paper') || name.includes('newspaper')) return ENERGY_SAVINGS.paper;
  if (name.includes('cardboard') || name.includes('box')) return ENERGY_SAVINGS.cardboard;
  if (name.includes('steel') || name.includes('metal')) return ENERGY_SAVINGS.steel;
  if (name.includes('organic') || name.includes('food')) return ENERGY_SAVINGS.organic;
  return ENERGY_SAVINGS.default;
};

const identifyWaste = async (imageBase64: string): Promise<WasteItem[]> => {
  try {
    const API_KEY = import.meta.env.VITE_PERPLEXITY_API_KEY as string;
    
    if (!API_KEY) {
      throw new Error('Perplexity API key not found. Add VITE_PERPLEXITY_API_KEY to your .env file');
    }

    const prompt = `You are a precise waste identification AI for Dubai, UAE. Analyze this image CAREFULLY.

CRITICAL INSTRUCTIONS:
1. Look at the ACTUAL items in the image - don't guess or assume
2. Be SPECIFIC about materials (e.g., "PET Plastic Bottle" not just "Bottle")
3. Only identify items you can CLEARLY see
4. Count each DISTINCT item separately
5. Provide a confidence score (0-100) for each item

DUBAI WASTE CATEGORIES (2026 Rules):
- recyclable: PET plastic bottles (#1), HDPE containers (#2), PP containers (#5), aluminum cans, cardboard, paper, glass bottles/jars
- organic: food waste, fruit/vegetable scraps, garden waste
- hazardous: batteries, electronics, chemicals, light bulbs, medical waste
- landfill: thin plastic film (<50 microns), styrofoam, mixed materials, contaminated items, plastic straws

IMPORTANT: PET/HDPE/PP plastic bottles and containers ARE RECYCLABLE in Dubai.

RESPONSE FORMAT (JSON array only):
[
  {
    "name": "PET Plastic Water Bottle",
    "category": "recyclable",
    "instruction": "Remove cap and rinse clean. Look for #1 PET symbol. Place in GREEN recycling bin. Can be recycled into new bottles.",
    "confidence": 95
  }
]

Return ONLY the JSON array. No markdown, no explanations.`;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64 } }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error ${response.status}: ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;
    
    let jsonText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    } else {
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (jsonMatch) jsonText = jsonMatch[0];
    }
    
    const items = JSON.parse(jsonText);
    
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No items found in image');
    }
    
    const validItems = items.filter(item => 
      item.name && 
      item.category && 
      ['recyclable', 'organic', 'hazardous', 'landfill'].includes(item.category) &&
      item.instruction
    ).map(item => ({
      ...item,
      energySaved: calculateEnergySaved(item.name),
      confidence: item.confidence || 85
    }));
    
    if (validItems.length === 0) throw new Error('No valid items identified');
    
    return validItems;
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    throw error;
  }
};

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [items, setItems] = useState<WasteItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [points, setPoints] = useState(parseInt(localStorage.getItem('wasteless_points') || '0'));
  const [totalEnergySaved, setTotalEnergySaved] = useState(parseFloat(localStorage.getItem('wasteless_energy') || '0'));
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [streak, setStreak] = useState(parseInt(localStorage.getItem('wasteless_streak') || '0'));
  const [lastScan, setLastScan] = useState(localStorage.getItem('wasteless_last_scan') || '');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('wasteless_history');
    if (savedHistory) {
      try {
        setScanHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to load history:', e);
      }
    }
  }, []);

  const saveProgress = (newPoints: number, newEnergy: number) => {
    localStorage.setItem('wasteless_points', newPoints.toString());
    localStorage.setItem('wasteless_energy', newEnergy.toFixed(2));
  };

  const getBinInfo = (category: string): BinInfo => {
    const bins: Record<string, BinInfo> = {
      recyclable: { color: '#20593a', emoji: '♻️', name: 'GREEN Recycling Bin' },
      organic: { color: '#8B4513', emoji: '🌱', name: 'BROWN Organic Bin' },
      hazardous: { color: '#dc2626', emoji: '⚠️', name: 'RED Hazmat Container' },
      landfill: { color: '#1f2937', emoji: '🗑️', name: 'BLACK General Waste' },
    };
    return bins[category] || bins.landfill;
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setVideoStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert('Camera access denied. Please enable camera permissions.');
      setScreen('home');
    }
  };

  const stopCamera = () => {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      setVideoStream(null);
    }
  };

  const captureImage = async () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(videoRef.current, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);
    
    setIsProcessing(true);
    stopCamera();
    
    try {
      const identifiedItems = await identifyWaste(imageBase64);
      if (identifiedItems.length === 0) {
        alert('No items detected. Please try again with better lighting.');
        setIsProcessing(false);
        setScreen('home');
        return;
      }
      setItems(identifiedItems);
      setCheckedItems({});
      setSelectedItem(null);
      setScreen('results');
    } catch (error: any) {
      alert(`Error: ${error.message || 'Failed to analyze image'}`);
      setScreen('home');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleItem = (index: number) => {
    setCheckedItems(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const completeSort = () => {
    const checkedCount = Object.values(checkedItems).filter(Boolean).length;
    if (checkedCount === 0) {
      alert('Please check at least one item before completing!');
      return;
    }

    const earnedPoints = checkedCount * 10;
    const sortedItems = items.filter((_, i) => checkedItems[i]);
    const earnedEnergy = sortedItems.reduce((sum, item) => sum + item.energySaved, 0);
    
    const newPoints = points + earnedPoints;
    const newEnergy = totalEnergySaved + earnedEnergy;
    
    setPoints(newPoints);
    setTotalEnergySaved(newEnergy);
    saveProgress(newPoints, newEnergy);
    
    // Update streak
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    let newStreak = streak;
    if (lastScan === yesterday) {
      newStreak = streak + 1;
    } else if (lastScan !== today) {
      newStreak = 1;
    }
    
    setStreak(newStreak);
    setLastScan(today);
    localStorage.setItem('wasteless_streak', newStreak.toString());
    localStorage.setItem('wasteless_last_scan', today);

    // Save to history
    const newScan: ScanHistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      items: sortedItems,
      pointsEarned: earnedPoints,
      energySaved: earnedEnergy
    };
    const updatedHistory = [newScan, ...scanHistory].slice(0, 50);
    setScanHistory(updatedHistory);
    localStorage.setItem('wasteless_history', JSON.stringify(updatedHistory));
    
    alert(`🌟 Amazing Work!\n\n✅ Sorted ${checkedCount} items\n⭐ +${earnedPoints} points\n⚡ +${earnedEnergy.toFixed(1)} kWh saved\n🔥 ${newStreak} day streak!\n\n💰 Total: ${newPoints} pts | ${newEnergy.toFixed(1)} kWh`);
    setScreen('home');
  };

  useEffect(() => {
    if (screen === 'scanner') startCamera();
    return () => stopCamera();
  }, [screen]);

  // ANALYTICS SCREEN
  if (screen === 'analytics') {
    return <Analytics points={points} totalEnergySaved={totalEnergySaved} scanHistory={scanHistory} onBack={() => setScreen('home')} />;
  }

  // HISTORY SCREEN
  if (screen === 'history') {
    return <History scanHistory={scanHistory} onBack={() => setScreen('home')} />;
  }

  // MAP SCREEN
  if (screen === 'map') {
    return <LocationMap onBack={() => setScreen('home')} />;
  }

  // LEADERBOARD SCREEN
  if (screen === 'leaderboard') {
    return (
      <div style={{ minHeight: '100vh', background: 'white' }}>
        <div style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#20593a', margin: 0 }}>WASTEless</h1>
            <button onClick={() => setScreen('home')} style={{ padding: '10px 24px', background: '#f3f4f6', border: 'none', borderRadius: '12px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#e5e7eb'} onMouseLeave={(e) => e.currentTarget.style.background = '#f3f4f6'}>
              ← Back
            </button>
          </div>
        </div>
        <Leaderboard />
      </div>
    );
  }

  // HOME SCREEN
  if (screen === 'home') {
    const tier = points < 100 ? 'Bronze' : points < 500 ? 'Silver' : points < 1000 ? 'Gold' : 'Platinum';
    const tierColor = points < 100 ? '#cd7f32' : points < 500 ? '#c0c0c0' : points < 1000 ? '#ffd700' : '#e5e4e2';
    const nextTier = points < 100 ? 100 : points < 500 ? 500 : points < 1000 ? 1000 : 2000;

    return (
      <div style={{ minHeight: '100vh', background: 'white', padding: '24px 16px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
            <div>
              <h1 style={{ fontSize: '48px', fontWeight: 'bold', color: '#20593a', margin: 0, lineHeight: 1.1 }}>WASTEless</h1>
              <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '8px' }}>Dubai Smart Waste Initiative 🇦🇪</p>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#fef3c7', borderRadius: '12px', border: '2px solid #f59e0b' }}>
                  <span style={{ fontSize: '20px' }}>🔥</span>
                  <div>
                    <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#92400e', margin: 0 }}>{streak}</p>
                    <p style={{ fontSize: '10px', color: '#78350f', margin: 0 }}>streak</p>
                  </div>
                </div>
              )}
              <button onClick={() => setScreen('analytics')} style={{ padding: '12px 20px', background: 'white', border: '2px solid #20593a', borderRadius: '12px', fontWeight: 600, color: '#20593a', cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#20593a'; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#20593a'; }}>
                📊 Stats
              </button>
              <button onClick={() => setScreen('leaderboard')} style={{ padding: '12px 20px', background: '#20593a', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', boxShadow: '0 2px 8px rgba(32,89,58,0.3)', cursor: 'pointer', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                ⭐ {points}
              </button>
            </div>
          </div>

          {/* Stats Card */}
          <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '24px', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <p style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>Total Points</p>
                <p style={{ fontSize: '48px', fontWeight: 'bold', color: '#20593a', margin: 0, lineHeight: 1 }}>{points}</p>
              </div>
              <div>
                <p style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>Energy Saved</p>
                <p style={{ fontSize: '48px', fontWeight: 'bold', color: '#20593a', margin: 0, lineHeight: 1 }}>{totalEnergySaved.toFixed(1)} <span style={{ fontSize: '24px' }}>kWh</span></p>
              </div>
            </div>
            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Current Tier</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🏆</span>
                    <span style={{ fontSize: '20px', fontWeight: 'bold', color: tierColor }}>{tier}</span>
                  </div>
                </div>
              </div>
              <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg, #20593a 0%, #34d399 100%)', width: `${(points % nextTier) / nextTier * 100}%`, borderRadius: '999px', transition: 'width 0.5s' }} />
              </div>
              <p style={{ fontSize: '12px', color: '#9ca3af' }}>
                {nextTier - (points % nextTier)} points to {points < 100 ? 'Silver' : points < 500 ? 'Gold' : points < 1000 ? 'Platinum' : 'Diamond'}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <button onClick={() => setScreen('history')} style={{ padding: '16px', background: 'white', border: '2px solid #e5e7eb', borderRadius: '16px', fontWeight: 600, color: '#1f2937', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#20593a'; e.currentTarget.style.color = '#20593a'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#1f2937'; }}>
              📋 History
            </button>
            <button onClick={() => setScreen('map')} style={{ padding: '16px', background: 'white', border: '2px solid #e5e7eb', borderRadius: '16px', fontWeight: 600, color: '#1f2937', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#20593a'; e.currentTarget.style.color = '#20593a'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#1f2937'; }}>
              📍 Drop-off Locations
            </button>
          </div>

          {/* Scan Button */}
          <button onClick={() => setScreen('scanner')} style={{ width: '100%', padding: '24px', background: '#20593a', color: 'white', border: 'none', borderRadius: '20px', fontSize: '28px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(32,89,58,0.3)', cursor: 'pointer', marginBottom: '16px', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
            📸 SCAN WASTE NOW
          </button>

          {/* How it Works */}
          <div style={{ background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', marginBottom: '16px' }}>
            <p style={{ fontWeight: 'bold', fontSize: '18px', color: '#1f2937', marginBottom: '16px' }}>💡 How it works:</p>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {[
                { num: '1', text: 'Scan your waste with camera' },
                { num: '2', text: 'AI analyzes each item instantly' },
                { num: '3', text: 'Follow Dubai sorting instructions' },
                { num: '4', text: 'Earn points + track energy!' }
              ].map((step, idx) => (
                <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: idx < 3 ? '12px' : 0 }}>
                  <span style={{ flexShrink: 0, width: '28px', height: '28px', background: '#d1fae5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#20593a', fontSize: '14px' }}>{step.num}</span>
                  <span style={{ color: '#4b5563' }}>{step.text}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Impact Banner */}
          <div style={{ background: '#ecfdf5', border: '2px solid #20593a', borderRadius: '20px', padding: '20px' }}>
            <p style={{ fontSize: '14px', color: '#065f46', lineHeight: 1.6, margin: 0 }}>
              🇦🇪 <strong>Dubai 2026:</strong> GREEN bins = recyclables • BROWN = organic • BLACK = general • RED = hazardous. Recycling saves 70-95% energy!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // SCANNER SCREEN
  if (screen === 'scanner') {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'black' }}>
        <button onClick={() => { stopCamera(); setScreen('home'); }} style={{ position: 'fixed', top: '24px', right: '24px', width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', color: 'white', border: 'none', fontSize: '28px', cursor: 'pointer', zIndex: 20, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.9)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}>
          ✕
        </button>

        <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

        <div style={{ position: 'absolute', top: '80px', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '0 16px' }}>
          <p style={{ color: 'white', fontSize: '20px', fontWeight: 'bold', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', padding: '16px 32px', borderRadius: '16px', textAlign: 'center' }}>
            📸 Point camera at waste items
          </p>
          <p style={{ color: 'white', fontSize: '14px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', padding: '8px 24px', borderRadius: '12px', textAlign: 'center' }}>
            Make sure items are clearly visible
          </p>
        </div>

        {isProcessing ? (
          <div style={{ position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', color: 'white', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', padding: '24px 32px', borderRadius: '20px' }}>
            <div style={{ width: '64px', height: '64px', border: '4px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>🤖 AI analyzing...</p>
            <p style={{ fontSize: '14px', color: '#d1d5db', marginTop: '8px' }}>5-10 seconds</p>
          </div>
        ) : (
          <button onClick={captureImage} style={{ position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)', width: '80px', height: '80px', borderRadius: '50%', background: 'white', border: '4px solid rgba(255,255,255,0.3)', cursor: 'pointer', padding: '8px', transition: 'transform 0.2s' }} onMouseDown={(e) => e.currentTarget.style.transform = 'translateX(-50%) scale(0.95)'} onMouseUp={(e) => e.currentTarget.style.transform = 'translateX(-50%) scale(1)'}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#20593a' }} />
          </button>
        )}
      </div>
    );
  }

  // RESULTS SCREEN
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div style={{ minHeight: '100vh', background: 'white', paddingBottom: '160px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 16px' }}>
        <button onClick={() => setScreen('home')} style={{ marginBottom: '24px', padding: '12px 24px', background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.06)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
          ← Back
        </button>

        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#1f2937', marginBottom: '8px' }}>✅ Found: {items.length} items</h2>
          <p style={{ color: '#6b7280', fontSize: '18px' }}>Click cards for details • Check when sorted</p>
        </div>

        {/* Educational Tips */}
        <div style={{ background: '#f9fafb', borderRadius: '20px', padding: '24px', marginBottom: '24px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px' }}>💡 Did You Know?</h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            {[
              { icon: '♻️', fact: 'Recycling 1 aluminum can saves enough energy to run a TV for 3 hours' },
              { icon: '🌊', fact: 'Making plastic from recycled materials uses 88% less energy than virgin plastic' }
            ].map((tip, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '12px', padding: '12px', background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '24px' }}>{tip.icon}</span>
                <p style={{ color: '#4b5563', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>{tip.fact}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          {items.map((item, index) => {
            const binInfo = getBinInfo(item.category);
            const isChecked = checkedItems[index];
            const isSelected = selectedItem === index;
            
            return (
              <div key={index} style={{ background: isChecked ? '#ecfdf5' : 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: `2px solid ${isChecked ? '#20593a' : (isSelected ? '#20593a' : '#e5e7eb')}`, marginBottom: '16px', cursor: 'pointer', transition: 'all 0.3s' }} onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'} onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                  <button onClick={(e) => { e.stopPropagation(); toggleItem(index); }} style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: '12px', border: `2px solid ${isChecked ? '#20593a' : '#d1d5db'}`, background: isChecked ? '#20593a' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={(e) => !isChecked && (e.currentTarget.style.borderColor = '#20593a')} onMouseLeave={(e) => !isChecked && (e.currentTarget.style.borderColor = '#d1d5db')}>
                    {isChecked && <span style={{ color: 'white', fontSize: '24px' }}>✓</span>}
                  </button>

                  <div style={{ flex: 1 }} onClick={() => setSelectedItem(isSelected ? null : index)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>{item.name}</h3>
                      <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 500 }}>#{index + 1}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '12px', background: binInfo.color, color: 'white', fontWeight: 600 }}>
                        <span style={{ fontSize: '20px' }}>{binInfo.emoji}</span>
                        <span>{binInfo.name}</span>
                      </div>
                      {item.confidence && (
                        <span style={{ 
                          padding: '6px 12px', 
                          background: item.confidence > 90 ? '#d1fae5' : item.confidence > 70 ? '#fef3c7' : '#fee2e2',
                          color: item.confidence > 90 ? '#065f46' : item.confidence > 70 ? '#92400e' : '#991b1b',
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          {item.confidence}% sure
                        </span>
                      )}
                    </div>

                    {isSelected && (
                      <div style={{ marginTop: '16px', padding: '16px', background: '#ecfdf5', border: '2px solid #20593a', borderRadius: '12px' }}>
                        <p style={{ color: '#065f46', lineHeight: 1.6, marginBottom: '12px', fontSize: '15px' }}>
                          <span style={{ fontWeight: 600 }}>💡 Instructions:</span> {item.instruction}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#065f46', fontWeight: 600 }}>
                          <span>⚡ Energy saved:</span>
                          <span style={{ padding: '4px 12px', background: '#d1fae5', borderRadius: '999px' }}>{item.energySaved.toFixed(1)} kWh</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Action Bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', borderTop: '2px solid #e5e7eb', boxShadow: '0 -4px 12px rgba(0,0,0,0.08)', padding: '24px', zIndex: 10 }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>Progress</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>{checkedCount}/{items.length} sorted</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>You'll earn</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#20593a', margin: 0 }}>+{checkedCount * 10} pts</p>
              </div>
            </div>
            <button onClick={completeSort} disabled={checkedCount === 0} style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '20px', fontWeight: 'bold', border: 'none', cursor: checkedCount === 0 ? 'not-allowed' : 'pointer', background: checkedCount === 0 ? '#d1d5db' : '#20593a', color: checkedCount === 0 ? '#9ca3af' : 'white', boxShadow: checkedCount === 0 ? 'none' : '0 4px 12px rgba(32,89,58,0.3)', transition: 'all 0.2s' }} onMouseEnter={(e) => checkedCount > 0 && (e.currentTarget.style.transform = 'translateY(-2px)')} onMouseLeave={(e) => checkedCount > 0 && (e.currentTarget.style.transform = 'translateY(0)')}>
              {checkedCount === 0 ? 'Check items to continue' : '✓ Complete Sorting'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
