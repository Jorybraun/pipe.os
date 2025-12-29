import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Activity,
  Users,
  TrendingUp,
  Search,
  Plus,
} from 'lucide-react';
import {
  LiquidMetalCard,
  RoleCard,
  StatsCard,
} from '../components';
import { mockRoles, searchRoles } from '../mocks';
import type { Role } from '../types';

/**
 * ListingPage - Main entry point showing all roles/pipelines
 *
 * Features:
 * - Stats cards showing overview metrics
 * - Search and filter functionality
 * - Grid of role cards
 * - Navigation to pipeline builder and detail views
 *
 * Note: Layout is provided by AppLayout wrapper in App.tsx
 */
export default function ListingPage(): JSX.Element {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<'all' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter and search roles
  const filteredRoles = mockRoles.filter((role) => {
    const matchesFilter = filter === 'all' || role.status === filter;
    const matchesSearch = searchQuery === '' || searchRoles(searchQuery).some(r => r.id === role.id);
    return matchesFilter && matchesSearch;
  });

  // Calculate stats
  const stats = {
    totalRoles: mockRoles.length,
    activeRoles: mockRoles.filter((r) => r.status === 'ACTIVE').length,
    totalCandidates: mockRoles.reduce((sum, r) => sum + r.candidateCount, 0),
    avgScore: Math.round(
      mockRoles
        .filter((r) => r.avgScore > 0)
        .reduce((sum, r) => sum + r.avgScore, 0) / mockRoles.filter((r) => r.avgScore > 0).length
    ),
  };

  const handleRoleClick = (role: Role): void => {
    navigate(`/pipeline/${role.id}`);
  };

  const handleNewRole = (): void => {
    navigate('/pipeline/new');
  };

  return (
    <div style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {/* Create New Role Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
          <button
            onClick={handleNewRole}
            style={{
              padding: '14px 28px',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 11,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Plus size={16} />
            CREATE NEW ROLE
          </button>
        </div>
          {/* Stats Row */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 40,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
            }}
          >
            <StatsCard label="TOTAL ROLES" value={stats.totalRoles} icon={Briefcase} />
            <StatsCard label="ACTIVE ROLES" value={stats.activeRoles} icon={Activity} trend={{ value: "+2 THIS WEEK", direction: "up" }} />
            <StatsCard label="TOTAL CANDIDATES" value={stats.totalCandidates} icon={Users} trend={{ value: "+15 THIS WEEK", direction: "up" }} />
            <StatsCard label="AVG SCORE" value={stats.avgScore} icon={TrendingUp} />
          </section>

          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
                ALL_ROLES
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Search */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Search size={12} color="rgba(255,255,255,0.3)" />
                <input
                  type="text"
                  placeholder="Search roles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#fff',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    fontFamily: '"Space Mono", monospace',
                    width: 120,
                  }}
                />
              </div>

              {/* Filter buttons */}
              <div style={{ display: 'flex', gap: 2 }}>
                {(['all', 'ACTIVE', 'DRAFT', 'ARCHIVED'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '8px 14px',
                      background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: filter === f ? '#fff' : 'rgba(255,255,255,0.4)',
                      fontSize: 8,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Roles Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 16,
            }}
          >
            {filteredRoles.map((role) => (
              <RoleCard
                key={role.id}
                title={role.title}
                department={role.department}
                location={role.location}
                status={role.status === 'ARCHIVED' ? 'closed' : role.status.toLowerCase() as 'active' | 'draft' | 'closed'}
                candidates={role.candidateCount}
                avgScore={role.avgScore}
                stagesConfigured={Math.round((role.progress / 100) * role.stageCount)}
                totalStages={role.stageCount}
                createdAt={role.createdAt}
                onClick={() => handleRoleClick(role)}
              />
            ))}

            {/* Create New Role Card */}
            <div
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(20px)',
                transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${filteredRoles.length * 80}ms`,
              }}
            >
              <LiquidMetalCard
                variant="default"
                hover
                onClick={handleNewRole}
                style={{
                  minHeight: 280,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed rgba(255,255,255,0.15)',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                  }}
                >
                  <Plus size={24} color="rgba(255,255,255,0.4)" />
                </div>
                <div style={{ fontSize: 12, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                  CREATE NEW ROLE
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Set up a new hiring pipeline</div>
              </LiquidMetalCard>
            </div>
          </div>
    </div>
  );
}
