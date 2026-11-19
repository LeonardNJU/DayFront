import { useState } from 'react';
import { calendarPalette } from './palette.js';

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const colorName =
    calendarPalette.find(
      ([, color]) => color.toUpperCase() === value.toUpperCase(),
    )?.[0] ?? 'Custom';
  return (
    <div className="sl-color-row">
      <span className="sl-color-label">Color</span>
      <details
        className="sl-color-dropdown"
        open={opened}
        onToggle={(event) => setOpened(event.currentTarget.open)}
      >
        <summary title="Choose color" aria-label={'Color: ' + colorName}>
          <span
            className="sl-color-small-dot"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
          <span>{colorName}</span>
        </summary>
        <div className="sl-color-menu">
          {calendarPalette.map(([name, color]) => (
            <button
              type="button"
              key={name}
              className={
                color.toUpperCase() === value.toUpperCase() ? 'is-selected' : ''
              }
              aria-label={name}
              aria-pressed={color.toUpperCase() === value.toUpperCase()}
              onClick={() => {
                onChange(color);
                setOpened(false);
              }}
            >
              <span
                className="sl-color-small-dot"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span>{name}</span>
              {color.toUpperCase() === value.toUpperCase() && (
                <span aria-hidden="true">✓</span>
              )}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
