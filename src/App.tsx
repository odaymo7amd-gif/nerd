import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell.tsx';
import { FullPageLoader } from './components/ui.tsx';
import { useSession } from './lib/session.tsx';
import LoginPage from './pages/Login.tsx';
import RegisterPage from './pages/Register.tsx';
import ForgotPasswordPage from './pages/ForgotPassword.tsx';
import ResetPasswordPage from './pages/ResetPassword.tsx';
import OnboardingPage from './pages/Onboarding.tsx';
import HomePage from './pages/Home.tsx';
import ToolsPage from './pages/Tools.tsx';
import MorePage from './pages/More.tsx';
import SupportDeveloperPage from './pages/SupportDeveloper.tsx';
import ProfilePage from './pages/Profile.tsx';
import SettingsPage from './pages/Settings.tsx';
import NotificationsPage from './pages/Notifications.tsx';
import FeedbackPage from './pages/Feedback.tsx';
import DeveloperPage from './pages/Developer.tsx';
import DeveloperUserPage from './pages/DeveloperUser.tsx';
import ContentLibraryPage from './pages/ContentLibrary.tsx';
import ContentNewPage from './pages/ContentNew.tsx';
import ContentViewPage from './pages/ContentView.tsx';
import BooksPage from './pages/Books.tsx';
import BookUploadPage from './pages/BookUpload.tsx';
import BookViewPage from './pages/BookView.tsx';
import SummaryPage from './pages/Summary.tsx';
import SummaryViewPage from './pages/SummaryView.tsx';
import AssistantPage from './pages/Assistant.tsx';
import AskTeacherPage from './pages/AskTeacher.tsx';
import StudyToolPage from './pages/StudyTool.tsx';
import EnglishLearningPage, { ArabicLearningPage } from './pages/EnglishLearning.tsx';
import SchedulePage from './pages/Schedule.tsx';
import SearchPage from './pages/Search.tsx';
import ChallengePage from './pages/Challenge.tsx';
import TestsPage from './pages/Tests.tsx';
import QuestionBankPage from './pages/QuestionBank.tsx';
import TestViewPage from './pages/TestView.tsx';
import TestTakePage from './pages/TestTake.tsx';
import TestResultPage from './pages/TestResult.tsx';
import NotFoundPage from './pages/NotFound.tsx';
import LegalPage from './pages/Legal.tsx';

function Protected({ children, developerOnly = false }: { children: ReactNode; developerOnly?: boolean }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4">
        <FullPageLoader />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!user.onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  if (developerOnly && !user.isDeveloper) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4">
        <FullPageLoader />
      </div>
    );
  }
  if (user) return <Navigate to={user.onboarded ? '/' : '/onboarding'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnly>
            <ForgotPasswordPage />
          </PublicOnly>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicOnly>
            <ResetPasswordPage />
          </PublicOnly>
        }
      />

      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />

      <Route
        path="/"
        element={
          <Protected>
            <HomePage />
          </Protected>
        }
      />
      <Route
        path="/onboarding"
        element={
          <Protected>
            <OnboardingPage />
          </Protected>
        }
      />
      <Route
        path="/more"
        element={
          <Protected>
            <MorePage />
          </Protected>
        }
      />
      <Route
        path="/support"
        element={
          <Protected>
            <SupportDeveloperPage />
          </Protected>
        }
      />
      <Route
        path="/tools"
        element={
          <Protected>
            <ToolsPage />
          </Protected>
        }
      />
      <Route
        path="/content"
        element={
          <Protected>
            <ContentLibraryPage />
          </Protected>
        }
      />
      <Route
        path="/content/new"
        element={
          <Protected>
            <ContentNewPage />
          </Protected>
        }
      />
      <Route
        path="/content/:id"
        element={
          <Protected>
            <ContentViewPage />
          </Protected>
        }
      />
      <Route
        path="/books"
        element={
          <Protected>
            <BooksPage />
          </Protected>
        }
      />
      <Route
        path="/books/upload"
        element={
          <Protected>
            <BookUploadPage />
          </Protected>
        }
      />
      <Route
        path="/books/:id"
        element={
          <Protected>
            <BookViewPage />
          </Protected>
        }
      />
      <Route
        path="/schedule"
        element={
          <Protected>
            <SchedulePage />
          </Protected>
        }
      />
      <Route
        path="/search"
        element={
          <Protected>
            <SearchPage />
          </Protected>
        }
      />
      <Route
        path="/challenge"
        element={
          <Protected>
            <ChallengePage />
          </Protected>
        }
      />
      <Route
        path="/teacher"
        element={
          <Protected>
            <StudyToolPage mode="teacher" />
          </Protected>
        }
      />
      <Route
        path="/solver"
        element={
          <Protected>
            <StudyToolPage mode="solver" />
          </Protected>
        }
      />
      <Route
        path="/grader"
        element={
          <Protected>
            <StudyToolPage mode="grader" />
          </Protected>
        }
      />
      <Route
        path="/expression"
        element={
          <Protected>
            <StudyToolPage mode="expression" />
          </Protected>
        }
      />
      <Route
        path="/english-grammar"
        element={
          <Protected>
            <EnglishLearningPage />
          </Protected>
        }
      />
      <Route
        path="/arabic-grammar"
        element={
          <Protected>
            <ArabicLearningPage />
          </Protected>
        }
      />
      <Route
        path="/tests"
        element={
          <Protected>
            <TestsPage />
          </Protected>
        }
      />
      <Route
        path="/bank"
        element={
          <Protected>
            <QuestionBankPage />
          </Protected>
        }
      />
      <Route
        path="/tests/:id"
        element={
          <Protected>
            <TestViewPage />
          </Protected>
        }
      />
      <Route
        path="/tests/:id/take"
        element={
          <Protected>
            <TestTakePage />
          </Protected>
        }
      />
      <Route
        path="/tests/:id/results/:attemptId"
        element={
          <Protected>
            <TestResultPage />
          </Protected>
        }
      />
      <Route
        path="/assistant"
        element={
          <Protected>
            <AssistantPage />
          </Protected>
        }
      />
      <Route
        path="/ask-teacher"
        element={
          <Protected>
            <AskTeacherPage />
          </Protected>
        }
      />
      <Route
        path="/summary"
        element={
          <Protected>
            <SummaryPage />
          </Protected>
        }
      />
      <Route
        path="/summary/:id"
        element={
          <Protected>
            <SummaryViewPage />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <ProfilePage />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route
        path="/notifications"
        element={
          <Protected>
            <NotificationsPage />
          </Protected>
        }
      />
      <Route
        path="/feedback"
        element={
          <Protected>
            <FeedbackPage />
          </Protected>
        }
      />
      <Route
        path="/developer"
        element={
          <Protected developerOnly>
            <DeveloperPage />
          </Protected>
        }
      />
      <Route
        path="/developer/users/:id"
        element={
          <Protected developerOnly>
            <DeveloperUserPage />
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected>
            <Navigate to="/developer" replace />
          </Protected>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export { AppShell };
