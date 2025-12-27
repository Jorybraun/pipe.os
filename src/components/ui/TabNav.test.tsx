import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabNav, type Tab } from './TabNav';

describe('TabNav', () => {
  const mockTabs: Tab[] = [
    { id: 'question', label: 'QUESTION' },
    { id: 'video', label: 'VIDEO' },
    { id: 'rubric', label: 'RUBRIC' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const mockOnTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render all tabs', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      expect(screen.getByRole('tab', { name: 'QUESTION' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'VIDEO' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'RUBRIC' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'SETTINGS' })).toBeInTheDocument();
    });

    it('should render tab with icon', () => {
      const tabsWithIcon: Tab[] = [
        { id: 'test', label: 'TEST', icon: <span data-testid="test-icon">📝</span> },
      ];

      render(<TabNav tabs={tabsWithIcon} activeTab="test" onTabChange={mockOnTabChange} />);

      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /TEST/ })).toBeInTheDocument();
    });

    it('should mark active tab with aria-selected="true"', () => {
      render(<TabNav tabs={mockTabs} activeTab="video" onTabChange={mockOnTabChange} />);

      const videoTab = screen.getByRole('tab', { name: 'VIDEO' });
      expect(videoTab).toHaveAttribute('aria-selected', 'true');

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      expect(questionTab).toHaveAttribute('aria-selected', 'false');
    });

    it('should have tablist role on container', () => {
      const { container } = render(
        <TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeInTheDocument();
    });

    it('should set aria-controls attribute on tabs', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      expect(questionTab).toHaveAttribute('aria-controls', 'question-panel');
    });

    it('should set tabIndex=0 on active tab and tabIndex=-1 on inactive tabs', () => {
      render(<TabNav tabs={mockTabs} activeTab="rubric" onTabChange={mockOnTabChange} />);

      const rubricTab = screen.getByRole('tab', { name: 'RUBRIC' });
      expect(rubricTab).toHaveAttribute('tabIndex', '0');

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      expect(questionTab).toHaveAttribute('tabIndex', '-1');
    });
  });

  describe('Mouse Interaction', () => {
    it('should call onTabChange when a tab is clicked', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const videoTab = screen.getByRole('tab', { name: 'VIDEO' });
      fireEvent.click(videoTab);

      expect(mockOnTabChange).toHaveBeenCalledWith('video');
      expect(mockOnTabChange).toHaveBeenCalledTimes(1);
    });

    it('should call onTabChange when clicking already active tab', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      fireEvent.click(questionTab);

      expect(mockOnTabChange).toHaveBeenCalledWith('question');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should navigate to next tab with Arrow Right', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      fireEvent.keyDown(questionTab, { key: 'ArrowRight' });

      expect(mockOnTabChange).toHaveBeenCalledWith('video');
    });

    it('should navigate to previous tab with Arrow Left', () => {
      render(<TabNav tabs={mockTabs} activeTab="video" onTabChange={mockOnTabChange} />);

      const videoTab = screen.getByRole('tab', { name: 'VIDEO' });
      fireEvent.keyDown(videoTab, { key: 'ArrowLeft' });

      expect(mockOnTabChange).toHaveBeenCalledWith('question');
    });

    it('should wrap to last tab when pressing Arrow Left on first tab', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      fireEvent.keyDown(questionTab, { key: 'ArrowLeft' });

      expect(mockOnTabChange).toHaveBeenCalledWith('settings');
    });

    it('should wrap to first tab when pressing Arrow Right on last tab', () => {
      render(<TabNav tabs={mockTabs} activeTab="settings" onTabChange={mockOnTabChange} />);

      const settingsTab = screen.getByRole('tab', { name: 'SETTINGS' });
      fireEvent.keyDown(settingsTab, { key: 'ArrowRight' });

      expect(mockOnTabChange).toHaveBeenCalledWith('question');
    });

    it('should navigate to first tab with Home key', () => {
      render(<TabNav tabs={mockTabs} activeTab="rubric" onTabChange={mockOnTabChange} />);

      const rubricTab = screen.getByRole('tab', { name: 'RUBRIC' });
      fireEvent.keyDown(rubricTab, { key: 'Home' });

      expect(mockOnTabChange).toHaveBeenCalledWith('question');
    });

    it('should navigate to last tab with End key', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      fireEvent.keyDown(questionTab, { key: 'End' });

      expect(mockOnTabChange).toHaveBeenCalledWith('settings');
    });

    it('should activate tab with Enter key', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const videoTab = screen.getByRole('tab', { name: 'VIDEO' });
      fireEvent.keyDown(videoTab, { key: 'Enter' });

      expect(mockOnTabChange).toHaveBeenCalledWith('video');
    });

    it('should activate tab with Space key', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const rubricTab = screen.getByRole('tab', { name: 'RUBRIC' });
      fireEvent.keyDown(rubricTab, { key: ' ' });

      expect(mockOnTabChange).toHaveBeenCalledWith('rubric');
    });

    it('should prevent default behavior for keyboard navigation keys', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });

      const arrowRightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      const preventDefaultSpy = vi.spyOn(arrowRightEvent, 'preventDefault');
      fireEvent(questionTab, arrowRightEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not call onTabChange for non-navigation keys', () => {
      render(<TabNav tabs={mockTabs} activeTab="question" onTabChange={mockOnTabChange} />);

      const questionTab = screen.getByRole('tab', { name: 'QUESTION' });
      fireEvent.keyDown(questionTab, { key: 'a' });
      fireEvent.keyDown(questionTab, { key: 'Escape' });
      fireEvent.keyDown(questionTab, { key: 'Tab' });

      expect(mockOnTabChange).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tabs array gracefully', () => {
      render(<TabNav tabs={[]} activeTab="" onTabChange={mockOnTabChange} />);

      const tablist = screen.queryByRole('tablist');
      expect(tablist).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('should handle single tab', () => {
      const singleTab: Tab[] = [{ id: 'only', label: 'ONLY' }];
      render(<TabNav tabs={singleTab} activeTab="only" onTabChange={mockOnTabChange} />);

      const tab = screen.getByRole('tab', { name: 'ONLY' });
      expect(tab).toHaveAttribute('aria-selected', 'true');

      // Arrow keys should wrap to same tab
      fireEvent.keyDown(tab, { key: 'ArrowRight' });
      expect(mockOnTabChange).toHaveBeenCalledWith('only');
    });

    it('should handle activeTab that does not exist in tabs array', () => {
      render(<TabNav tabs={mockTabs} activeTab="nonexistent" onTabChange={mockOnTabChange} />);

      // All tabs should have aria-selected="false"
      mockTabs.forEach((tab) => {
        const element = screen.getByRole('tab', { name: tab.label });
        expect(element).toHaveAttribute('aria-selected', 'false');
      });
    });
  });
});
