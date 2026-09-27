import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { APP_VERSION_LABEL } from '../../appVersion';
import ReleaseNotesModal from '../ReleaseNotesModal';

describe('ReleaseNotesModal Component', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(<ReleaseNotesModal isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders correctly when isOpen is true', () => {
    render(<ReleaseNotesModal isOpen={true} onClose={() => {}} />);
    
    expect(screen.getByText('Release Notes')).toBeInTheDocument();
    expect(screen.getByText(APP_VERSION_LABEL)).toBeInTheDocument();
    expect(screen.getByText('v1.5.0')).toBeInTheDocument();
    expect(screen.getByText('Release Notes & Stability improvements')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('calls onClose when close button or close at the bottom is clicked', () => {
    const handleClose = vi.fn();
    render(<ReleaseNotesModal isOpen={true} onClose={handleClose} />);
    
    // Close button (X)
    const closeBtn = screen.getByLabelText(/Close release notes modal/i);
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Close button at bottom (exact match for "Close" text button)
    const bottomCloseBtn = screen.getByRole('button', { name: /^close$/i });
    fireEvent.click(bottomCloseBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(<ReleaseNotesModal isOpen={true} onClose={handleClose} />);
    
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
