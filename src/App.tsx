import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ListingPage from './pages/ListingPage';
import OverviewPage from './pages/OverviewPage';
import PipelineDetailPage from './pages/PipelineDetailPage';
import CandidateProfilePage from './pages/CandidateProfilePage';
import CandidateScreeningPage from './pages/CandidateScreeningPage';
import { QuestionDetail } from './components/QuestionDetail';

/**
 * App - Main application component with routing configuration
 *
 * Routes:
 * - / → ListingPage (main entry point)
 * - /pipeline/:id → OverviewPage (pipeline overview)
 * - /pipeline/:id/:stage → PipelineDetailPage (stage detail, questions list)
 * - /pipeline/:id/:stage/:questionId → QuestionDetail (nested route, question detail)
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
        <Route path="/pipeline/:id" element={<OverviewPage />}>
          <Route index element={null} />
          <Route path=":stage" element={<PipelineDetailPage />} />
          <Route path=":stage/:questionId" element={<QuestionDetail />} />
        </Route>

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
