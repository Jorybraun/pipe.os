import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ListingPage from './pages/ListingPage';
import OverviewPage from './pages/OverviewPage';
import PipelineBuilderPage from './pages/PipelineBuilderPage';
import ScreeningStageBuilderPage from './pages/ScreeningStageBuilderPage';
import CandidateProfilePage from './pages/CandidateProfilePage';
import CandidateScreeningPage from './pages/CandidateScreeningPage';

/**
 * App - Main application component with routing configuration
 *
 * Routes:
 * - / → ListingPage (main entry point)
 * - /pipelines/:id → OverviewPage (pipeline detail)
 * - /pipelines/new → PipelineBuilderPage
 * - /pipelines/new/stages → ScreeningStageBuilderPage
 * - /candidates/:id → CandidateProfilePage
 * - /screenings/:id/preview → CandidateScreeningPage
 */
function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main entry point */}
        <Route path="/" element={<ListingPage />} />

        {/* Pipeline routes */}
        <Route path="/pipelines/:id" element={<OverviewPage />} />
        <Route path="/pipelines/new" element={<PipelineBuilderPage />} />
        <Route path="/pipelines/new/stages" element={<ScreeningStageBuilderPage />} />

        {/* Candidate routes */}
        <Route path="/candidates/:id" element={<CandidateProfilePage />} />
        <Route path="/screenings/:id/preview" element={<CandidateScreeningPage />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
