import { SchedulingDashboard } from '../components/Scheduling/SchedulingDashboard';

/**
 * SchedulingPage — recruiter-facing interview schedule.
 * Route: /schedule (protected, inside AppLayout)
 */
export default function SchedulingPage(): JSX.Element {
  return <SchedulingDashboard />;
}
