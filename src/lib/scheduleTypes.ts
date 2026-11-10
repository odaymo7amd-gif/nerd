export interface StudyTask {
  id: number;
  title: string;
  studyDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isCompleted: boolean;
  notes: string | null;
  subjectId: number | null;
  subjectName: string | null;
  contentId: number | null;
  contentTitle: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ScheduleStats {
  total: number;
  completed: number;
  remaining: number;
  plannedMinutes: number;
  completedMinutes: number;
  todayCount: number;
  todayCompleted: number;
  streakDays: number;
}

export interface ScheduleResponse {
  range: { from: string; to: string };
  today: string;
  tasks: StudyTask[];
  stats: ScheduleStats;
}
