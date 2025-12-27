export default function QuestionDetailPrototype () {
    const mounted = true;
          return <main style={{ 
        padding: '32px', 
        maxWidth: 1000, 
        margin: '0 auto',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
      }}>
        {/* Tabs */}
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />

        {/* Question Tab */}
        {activeTab === 'question' && (
          <div>
            <SubTitle>QUESTION_CONTENT</SubTitle>
            
            {/* Question text */}
            <LiquidMetalCard variant="mercury" style={{ padding: 24, marginTop: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                QUESTION TEXT
              </div>
              <textarea
                value={questionText}
                onChange={(e) => { setQuestionText(e.target.value); setHasChanges(true); }}
                style={{
                  width: '100%',
                  height: 120,
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 15,
                  lineHeight: 1.7,
                  padding: 16,
                  resize: 'none',
                  outline: 'none',
                  fontFamily: '"Space Mono", monospace',
                }}
              />
            </LiquidMetalCard>

            {/* Question settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Type */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                  QUESTION TYPE
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {typeOptions.map(type => (
                    <button
                      key={type}
                      onClick={() => { setQuestionType(type); setHasChanges(true); }}
                      style={{
                        padding: '8px 14px',
                        background: questionType === type ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${questionType === type ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                        color: questionType === type ? '#fff' : 'rgba(255,255,255,0.5)',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </LiquidMetalCard>

              {/* Time limit */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                  RESPONSE TIME LIMIT
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button 
                    onClick={() => { setTimeLimit(Math.max(1, timeLimit - 1)); setHasChanges(true); }}
                    style={{
                      width: 36,
                      height: 36,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Minus size={14} />
                  </button>
                  <div style={{
                    flex: 1,
                    height: 48,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{timeLimit}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>MIN</span>
                  </div>
                  <button 
                    onClick={() => { setTimeLimit(Math.min(10, timeLimit + 1)); setHasChanges(true); }}
                    style={{
                      width: 36,
                      height: 36,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Required toggle */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                      REQUIRED
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                      Candidates must answer this question
                    </div>
                  </div>
                  <button 
                    onClick={() => { setIsRequired(!isRequired); setHasChanges(true); }}
                    style={{
                      width: 56,
                      height: 28,
                      background: isRequired ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)',
                      border: `1px solid ${isRequired ? 'rgba(150,255,150,0.5)' : 'rgba(255,255,255,0.15)'}`,
                      cursor: 'pointer',
                      position: 'relative',
                      padding: 2,
                    }}
                  >
                    <div style={{
                      width: 22,
                      height: 22,
                      background: isRequired ? 'rgba(150,255,150,0.9)' : 'rgba(255,255,255,0.4)',
                      position: 'absolute',
                      left: isRequired ? 'calc(100% - 24px)' : '2px',
                      transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Video status */}
              <LiquidMetalCard variant={hasVideo ? 'mercury' : 'default'} style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {hasVideo ? (
                      <div style={{ width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 6px rgba(150,255,150,0.5)' }} />
                    ) : (
                      <div style={{ width: 8, height: 8, background: 'rgba(255,200,100,0.6)' }} />
                    )}
                    <div>
                      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                        VIDEO
                      </div>
                      <div style={{ fontSize: 11, color: hasVideo ? 'rgba(150,255,150,0.8)' : 'rgba(255,200,100,0.8)' }}>
                        {hasVideo ? `Recorded · ${Math.floor(videoDuration / 60)}:${(videoDuration % 60).toString().padStart(2, '0')}` : 'No video recorded'}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('video')}
                    style={{
                      padding: '8px 14px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Video size={12} />
                    {hasVideo ? 'EDIT' : 'RECORD'}
                  </button>
                </div>
              </LiquidMetalCard>
            </div>
          </div>
        )}

        {/* Video Tab */}
        {activeTab === 'video' && (
          <div>
            <SubTitle>VIDEO_RECORDING</SubTitle>
            <div style={{ marginTop: 16 }}>
              <VideoRecorder 
                hasExistingVideo={hasVideo}
                existingDuration={videoDuration}
                onSave={(duration) => { 
                  setHasVideo(true); 
                  setVideoDuration(duration); 
                  setHasChanges(true); 
                }}
              />
            </div>
          </div>
        )}

        {/* Rubric Tab */}
        {activeTab === 'rubric' && (
          <div>
            <SubTitle>SCORING_RUBRIC</SubTitle>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '16px 0 24px' }}>
              Define the criteria used to evaluate candidate responses. Each criterion has a weight that contributes to the overall score.
            </p>
            <RubricEditor onChange={() => setHasChanges(true)} />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div>
            <SubTitle>QUESTION_SETTINGS</SubTitle>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Allow Re-recording</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Candidates can re-record their response before submitting</div>
                  </div>
                  <button style={{
                    width: 56,
                    height: 28,
                    background: 'rgba(150,255,150,0.3)',
                    border: '1px solid rgba(150,255,150,0.5)',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: 2,
                  }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      background: 'rgba(150,255,150,0.9)',
                      position: 'absolute',
                      right: 2,
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Preparation Countdown</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Time given to prepare before recording starts</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>30</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>SEC</span>
                  </div>
                </div>
              </LiquidMetalCard>

              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Auto-Advance</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Automatically move to next question after time limit</div>
                  </div>
                  <button style={{
                    width: 56,
                    height: 28,
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: 2,
                  }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      background: 'rgba(255,255,255,0.4)',
                      position: 'absolute',
                      left: 2,
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Danger zone */}
              <div style={{ marginTop: 24 }}>
                <SubTitle>DANGER_ZONE</SubTitle>
                <LiquidMetalCard variant="dark" style={{ padding: 24, marginTop: 16, border: '1px solid rgba(255,80,80,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,80,80,0.9)', marginBottom: 4 }}>Delete Question</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>This action cannot be undone</div>
                    </div>
                    <button style={{
                      padding: '10px 20px',
                      background: 'rgba(255,80,80,0.1)',
                      border: '1px solid rgba(255,80,80,0.3)',
                      color: 'rgba(255,80,80,0.9)',
                      fontSize: 9,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <Trash2 size={12} />
                      DELETE
                    </button>
                  </div>
                </LiquidMetalCard>
              </div>
            </div>
          </div>
        )}
      </main>
}