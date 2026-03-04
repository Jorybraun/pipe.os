import { useState, useEffect, useMemo } from 'react';
import { generateClient } from 'aws-amplify/data';
import { Plus, Search } from 'lucide-react';
import type { Schema } from '../../amplify/data/resource';
import { ALL_CHALLENGE_TEMPLATES } from '../content/challengeLibrary';
import { Skeleton } from '../components/ui/Skeleton';
import { useNavigate } from 'react-router-dom';
import { ChallengeCard } from '../components/Pipeline/ChallengeCard';
import { CreateChallengeModal } from '../components/ChallengeLibrary/CreateChallengeModal';

const client = generateClient<Schema>();

type Challenge = Schema['Challenge']['type'];

/**
 * ChallengeLibraryPage - Master view for all challenges.
 * Styled exactly like SchedulingDashboard.
 */
export default function ChallengeLibraryPage(): JSX.Element {
  const navigate = useNavigate();
  const [userChallenges, setUserChallenges] = useState<Challenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'LIBRARY' | 'MY_CUSTOM'>('LIBRARY');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchUserChallenges = async () => {
      try {
        setIsLoading(true);
        const { data } = await client.models.Challenge.list();
        setUserChallenges((data || []).filter(c => !c.isSystem) as Challenge[]);
      } catch (err) {
        console.error('[ChallengeLibrary] Error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUserChallenges();
  }, []);

  const handleCreateChallenge = async (title: string, type: any) => {
    try {
      const { data: newChallenge } = await client.models.Challenge.create({
        title,
        type,
        isSystem: false,
        config: JSON.stringify({}),
        serverConfig: JSON.stringify({})
      });
      if (newChallenge) {
        navigate(`/studio/${newChallenge.id}`);
      }
    } catch (err) {
      console.error('Failed to create challenge:', err);
    }
  };

  const allChallenges = useMemo(() => {
    const templates = ALL_CHALLENGE_TEMPLATES.map(t => ({
      ...t,
      isSystem: true,
      config: JSON.stringify(t.config),
    })) as unknown as Challenge[];

    return sidebarTab === 'LIBRARY' ? templates : userChallenges;
  }, [userChallenges, sidebarTab]);

  const filteredChallenges = useMemo(() => {
    return allChallenges.filter(c => 
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allChallenges, searchQuery]);

  if (isLoading && userChallenges.length === 0) {
    return (
      <div style={{ padding: '0 40px' }}>
        <Skeleton width={120} height={10} style={{ marginBottom: 12 }} />
        <Skeleton width={300} height={40} style={{ marginBottom: 48 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={80} style={{ borderRadius: 8 }} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px 100px' }}>
      {/* Header — Identical to SchedulingDashboard */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            CHALLENGE_REPOSITORY
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
            Challenges
          </h1>
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', marginTop: 8 }}>
          {filteredChallenges.length} items
        </div>
      </div>

      {/* Tabs & Search — Styled like SchedulingFilters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: 2, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['LIBRARY', 'MY_CUSTOM'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              style={{
                padding: '8px 16px',
                background: sidebarTab === tab ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                borderRadius: 4,
                color: sidebarTab === tab ? '#fff' : 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'Space Mono',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={14} color="rgba(255,255,255,0.2)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search challenges..."
            style={{
              width: '100%',
              padding: '10px 16px 10px 36px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontFamily: 'Space Mono',
              outline: 'none'
            }}
          />
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          style={{
            padding: '10px 20px',
            background: '#fff',
            border: 'none',
            borderRadius: 6,
            color: '#000',
            fontSize: 10,
            fontWeight: 800,
            fontFamily: 'Space Mono',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Plus size={14} /> NEW_CHALLENGE
        </button>
      </div>

      {/* List — Reusing project ChallengeCard */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredChallenges.length === 0 ? (
          <div style={{ padding: 64, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12 }}>
             <p style={{ color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>No challenges found matching your criteria.</p>
          </div>
        ) : (
          filteredChallenges.map(c => (
            <ChallengeCard 
              key={c.id} 
              challenge={c as any} 
              isSortable={false}
              onClick={() => navigate(`/studio/${c.id}`)} 
            />
          ))
        )}
      </div>

      {isModalOpen && (
        <CreateChallengeModal 
          onClose={() => setIsModalOpen(false)} 
          onCreate={handleCreateChallenge} 
        />
      )}
    </div>
  );
}
