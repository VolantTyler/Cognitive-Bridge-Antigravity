import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OceanCards from '../OceanCards';
import { OceanScores } from '../../types';

const scoresWithDirectives: OceanScores = {
  openness: 50,
  conscientiousness: 15,
  extroversion: 50,
  agreeableness: 90,
  neuroticism: 50,
};

describe('OceanCards strategy badge layout', () => {
  it('renders trait labels without strategy badges in the header row', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    expect(screen.getByText('Conscientiousness')).toBeInTheDocument();
    expect(screen.getByText('Agreeableness')).toBeInTheDocument();

    const conscientiousnessHeader = screen.getByText('Conscientiousness').closest('div');
    expect(conscientiousnessHeader?.textContent).not.toMatch(/Compensatory|Congruent/);
  });

  it('places responsive strategy badges beside scores on md+ and below bars on mobile', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    const desktopBadges = screen.getAllByTestId('ocean-strategy-badge-desktop');
    const mobileBadges = screen.getAllByTestId('ocean-strategy-badge-mobile');

    expect(desktopBadges).toHaveLength(2);
    expect(mobileBadges).toHaveLength(2);

    for (const badge of desktopBadges) {
      expect(badge.className).toMatch(/hidden md:inline-flex/);
    }
    for (const badge of mobileBadges) {
      expect(badge.className).toMatch(/md:hidden/);
      expect(badge.className).toMatch(/inline-flex/);
    }

    for (const badge of desktopBadges) {
      expect(badge.className).not.toMatch(/(?:^|\s)inline-flex(?:\s|$)/);
    }

    expect(desktopBadges[0].querySelector('button')?.textContent).toBe('Compensatory');
    expect(mobileBadges[0].querySelector('button')?.textContent).toBe('Compensatory');
  });

  it('keeps strategy badge tooltips accessible on both responsive instances', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    const desktopBadge = screen.getAllByTestId('ocean-strategy-badge-desktop')[0];
    const button = desktopBadge.querySelector('button');

    expect(button).toHaveAttribute('aria-describedby');
    expect(desktopBadge.querySelector('[role="tooltip"]')?.textContent).toMatch(/Need-complementarity/i);
  });
});
