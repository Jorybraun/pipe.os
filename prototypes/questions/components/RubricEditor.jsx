import React from 'react';
import { Plus, Minus, Trash2, Percent, AlertCircle, CheckCircle } from 'lucide-react';
import { LiquidMetalCard } from './ui/LiquidMetalCard';

/**
 * Rubric editor component for defining scoring criteria.
 * Fully controlled - parent manages all dimension state.
 */
export function RubricEditor({ dimensions, onChange }) {
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);

  const updateDimension = (id, field, value) => {
    const updated = dimensions.map(d =>
      d.id === id ? { ...d, [field]: value } : d
    );
    onChange(updated);
  };

  const addDimension = () => {
    const newId = Math.max(...dimensions.map(d => d.id), 0) + 1;
    onChange([...dimensions, {
      id: newId,
      name: 'New Criterion',
      weight: 0,
      description: 'Enter description...',
    }]);
  };

  const removeDimension = (id) => {
    if (dimensions.length > 1) {
      onChange(dimensions.filter(d => d.id !== id));
    }
  };

  return (
    <div>
      {/* Weight status */}
      <LiquidMetalCard
        variant={totalWeight === 100 ? 'mercury' : 'default'}
        style={{ padding: 20, marginBottom: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Percent size={18} color={totalWeight === 100 ? 'rgba(150,255,150,0.8)' : 'rgba(255,200,100,0.8)'} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>TOTAL WEIGHT</div>
              <div style={{
                fontSize: 24,
                fontWeight: 800,
                color: totalWeight === 100 ? 'rgba(150,255,150,0.9)' : 'rgba(255,200,100,0.9)',
              }}>
                {totalWeight}%
              </div>
            </div>
          </div>
          {totalWeight !== 100 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,200,100,0.8)' }}>
              <AlertCircle size={14} />
              <span style={{ fontSize: 10, letterSpacing: '0.1em' }}>
                {totalWeight < 100 ? `ADD ${100 - totalWeight}%` : `REMOVE ${totalWeight - 100}%`}
              </span>
            </div>
          )}
          {totalWeight === 100 && (
            <CheckCircle size={20} color="rgba(150,255,150,0.8)" />
          )}
        </div>
      </LiquidMetalCard>

      {/* Dimensions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {dimensions.map((dimension, i) => (
          <LiquidMetalCard key={dimension.id} variant="dark" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              {/* Order indicator */}
              <div style={{
                width: 32,
                height: 32,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{i + 1}</span>
              </div>

              {/* Content */}
              <div style={{ flex: 1 }}>
                {/* Name input */}
                <input
                  type="text"
                  value={dimension.name}
                  onChange={(e) => updateDimension(dimension.id, 'name', e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    padding: '4px 0',
                    outline: 'none',
                    fontFamily: '"Space Mono", monospace',
                    marginBottom: 8,
                  }}
                />

                {/* Description input */}
                <textarea
                  value={dimension.description}
                  onChange={(e) => updateDimension(dimension.id, 'description', e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 11,
                    lineHeight: 1.6,
                    padding: 10,
                    resize: 'none',
                    outline: 'none',
                    fontFamily: '"Space Mono", monospace',
                    height: 60,
                  }}
                />
              </div>

              {/* Weight control */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>WEIGHT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => updateDimension(dimension.id, 'weight', Math.max(0, dimension.weight - 5))}
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Minus size={12} />
                  </button>
                  <div style={{
                    width: 48,
                    height: 36,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{dimension.weight}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>%</span>
                  </div>
                  <button
                    onClick={() => updateDimension(dimension.id, 'weight', Math.min(100, dimension.weight + 5))}
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeDimension(dimension.id)}
                  disabled={dimensions.length <= 1}
                  style={{
                    marginTop: 8,
                    padding: '4px 8px',
                    background: 'transparent',
                    border: 'none',
                    color: dimensions.length > 1 ? 'rgba(255,80,80,0.5)' : 'rgba(255,255,255,0.2)',
                    cursor: dimensions.length > 1 ? 'pointer' : 'not-allowed',
                    fontSize: 8,
                    letterSpacing: '0.1em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Trash2 size={10} />
                  REMOVE
                </button>
              </div>
            </div>

            {/* Weight bar */}
            <div style={{ marginTop: 16, height: 3, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{
                width: `${dimension.weight}%`,
                height: '100%',
                background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.6))',
                transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </LiquidMetalCard>
        ))}
      </div>

      {/* Add dimension button */}
      <button
        onClick={addDimension}
        style={{
          width: '100%',
          marginTop: 12,
          padding: 20,
          background: 'transparent',
          border: '1px dashed rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 10,
          letterSpacing: '0.15em',
        }}
      >
        <Plus size={14} />
        ADD CRITERION
      </button>
    </div>
  );
}
