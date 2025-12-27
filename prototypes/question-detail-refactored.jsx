import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  AlertCircle,
  Eye,
  Save,
  Edit3,
  Video,
  BarChart3,
  Settings,
} from 'lucide-react';
import { ChromeMeshGrid } from './questions/components/ui/ChromeMeshGrid';
import { TabNav } from './questions/components/ui/TabNav';
import { QuestionContent } from './questions/components/tabs/QuestionContent';
import { VideoContent } from './questions/components/tabs/VideoContent';
import { RubricContent } from './questions/components/tabs/RubricContent';
import { SettingsContent } from './questions/components/tabs/SettingsContent';

/**
 * Main question detail component.
 * Manages all state and delegates rendering to presentational components.
 */
export default function QuestionDetail() {
  // Mount animation
  const [mounted, setMounted] = useState(false);

  // Navigation state
  const [activeTab, setActiveTab] = useState('question');

  // Change tracking
  const [hasChanges, setHasChanges] = useState(false);

  // Question state
  const [questionText, setQuestionText] = useState(
    'Tell me about your experience with distributed systems and how you\'ve applied that knowledge in previous roles.'
  );
  const [questionType, setQuestionType] = useState('technical');
  const [timeLimit, setTimeLimit] = useState(3);
  const [isRequired, setIsRequired] = useState(true);

  // Video state
  const [hasVideo, setHasVideo] = useState(true);
  const [videoDuration, setVideoDuration] = useState(45);

  // Rubric state
  const [dimensions, setDimensions] = useState([
    { id: 1, name: 'Technical Knowledge', weight: 30, description: 'Demonstrates understanding of relevant technical concepts' },
    { id: 2, name: 'Problem Solving', weight: 25, description: 'Shows logical approach to breaking down problems' },
    { id: 3, name: 'Communication', weight: 25, description: 'Explains concepts clearly and concisely' },
    { id: 4, name: 'Experience Relevance', weight: 20, description: 'Provides relevant examples from past work' },
  ]);

  // Settings state
  const [allowRerecording, setAllowRerecording] = useState(true);
  const [preparationTime, setPreparationTime] = useState(30);
  const [autoAdvance, setAutoAdvance] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const tabs = [
    { id: 'question', label: 'QUESTION', icon: Edit3 },
    { id: 'video', label: 'VIDEO', icon: Video },
    { id: 'rubric', label: 'RUBRIC', icon: BarChart3 },
    { id: 'settings', label: 'SETTINGS', icon: Settings },
  ];

  // Handlers
  const handleSave = () => {
    setHasChanges(false);
    // Save logic here
    console.log('Saving question data...');
  };

  const handleQuestionTextChange = (value) => {
    setQuestionText(value);
    setHasChanges(true);
  };

  const handleQuestionTypeChange = (value) => {
    setQuestionType(value);
    setHasChanges(true);
  };

  const handleTimeLimitChange = (value) => {
    setTimeLimit(value);
    setHasChanges(true);
  };

  const handleIsRequiredChange = (value) => {
    setIsRequired(value);
    setHasChanges(true);
  };

  const handleEditVideo = () => {
    setActiveTab('video');
  };

  const handleVideoSave = (duration) => {
    setHasVideo(true);
    setVideoDuration(duration);
    setHasChanges(true);
  };

  const handleVideoDelete = () => {
    setHasVideo(false);
    setVideoDuration(0);
    setHasChanges(true);
  };

  const handleDimensionsChange = (newDimensions) => {
    setDimensions(newDimensions);
    setHasChanges(true);
  };

  const handleAllowRerecordingChange = (value) => {
    setAllowRerecording(value);
    setHasChanges(true);
  };

  const handleAutoAdvanceChange = (value) => {
    setAutoAdvance(value);
    setHasChanges(true);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
      console.log('Deleting question...');
      // Navigate back or delete logic
    }
  };

  const handleBack = () => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        // Navigate back
        console.log('Navigating back...');
      }
    } else {
      // Navigate back
      console.log('Navigating back...');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />

      {/* Header */}
      <header style={{
        padding: '24px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button
                onClick={handleBack}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 9,
                  letterSpacing: '0.1em'
                }}
              >
                <ChevronLeft size={12} />
                SCREENING
              </button>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.6)' }}>QUESTION 1</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
            </div>
            <h1 style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '8px 0 0',
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
            }}>
              EDIT_QUESTION
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {hasChanges && (
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,200,100,0.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={12} />
                UNSAVED CHANGES
              </span>
            )}
            <button style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 10,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <Eye size={12} />
              PREVIEW
            </button>
            <button
              onClick={handleSave}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                fontSize: 10,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              }}
            >
              <Save size={12} />
              SAVE QUESTION
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        padding: '32px',
        maxWidth: 1000,
        margin: '0 auto',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
      }}>
        {/* Tabs */}
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />

        {/* Tab Content */}
        {activeTab === 'question' && (
          <QuestionContent
            questionText={questionText}
            questionType={questionType}
            timeLimit={timeLimit}
            isRequired={isRequired}
            hasVideo={hasVideo}
            videoDuration={videoDuration}
            onQuestionTextChange={handleQuestionTextChange}
            onQuestionTypeChange={handleQuestionTypeChange}
            onTimeLimitChange={handleTimeLimitChange}
            onIsRequiredChange={handleIsRequiredChange}
            onEditVideo={handleEditVideo}
          />
        )}

        {activeTab === 'video' && (
          <VideoContent
            hasVideo={hasVideo}
            videoDuration={videoDuration}
            onSave={handleVideoSave}
            onDelete={handleVideoDelete}
          />
        )}

        {activeTab === 'rubric' && (
          <RubricContent
            dimensions={dimensions}
            onDimensionsChange={handleDimensionsChange}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsContent
            allowRerecording={allowRerecording}
            preparationTime={preparationTime}
            autoAdvance={autoAdvance}
            onAllowRerecordingChange={handleAllowRerecordingChange}
            onPreparationTimeChange={setPreparationTime}
            onAutoAdvanceChange={handleAutoAdvanceChange}
            onDelete={handleDelete}
          />
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  );
}
