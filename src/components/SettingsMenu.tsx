import {
  Button,
  Divider,
  Popover,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import CogIcon from '@patternfly/react-icons/dist/esm/icons/cog-icon'
import { useTheme } from '../lib/theme'

/**
 * Masthead settings panel, following the OpenShift console pattern: a gear
 * opens segmented Color scheme and Contrast mode controls.
 */
export function SettingsMenu() {
  const { mode, contrast, setMode, setContrast } = useTheme()

  const body = (
    <div className="app-settings-panel">
      <section className="app-settings-section">
        <h3>Color scheme</h3>
        <ToggleGroup aria-label="Color scheme">
          <ToggleGroupItem
            text="System"
            isSelected={mode === 'system'}
            onChange={() => setMode('system')}
          />
          <ToggleGroupItem
            text="Light"
            isSelected={mode === 'light'}
            onChange={() => setMode('light')}
          />
          <ToggleGroupItem
            text="Dark"
            isSelected={mode === 'dark'}
            onChange={() => setMode('dark')}
          />
        </ToggleGroup>
      </section>
      <Divider />
      <section className="app-settings-section">
        <h3>Contrast mode</h3>
        <ToggleGroup aria-label="Contrast mode">
          <ToggleGroupItem
            text="System"
            isSelected={contrast === 'system'}
            onChange={() => setContrast('system')}
          />
          <ToggleGroupItem
            text="Default"
            isSelected={contrast === 'default'}
            onChange={() => setContrast('default')}
          />
          <ToggleGroupItem
            text="High contrast"
            isSelected={contrast === 'high'}
            onChange={() => setContrast('high')}
          />
          <ToggleGroupItem
            text="Glass"
            isSelected={contrast === 'glass'}
            onChange={() => setContrast('glass')}
          />
        </ToggleGroup>
      </section>
    </div>
  )

  return (
    <Popover
      aria-label="Settings"
      headerContent="Settings"
      bodyContent={body}
      position="bottom-end"
      hasAutoWidth
      maxWidth="24rem"
      distance={8}
    >
      <Button variant="plain" aria-label="Settings">
        <CogIcon />
      </Button>
    </Popover>
  )
}
