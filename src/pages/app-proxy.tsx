import {
  AddRounded,
  DeleteRounded,
  EditRounded,
  FolderOpenRounded,
  PlayArrowRounded,
  SaveRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { open } from '@tauri-apps/plugin-dialog'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { launchAppWithProxy } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getFileName = (path: string) => {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || ''
}

const emptyForm = {
  id: '',
  name: '',
  path: '',
  args: '',
  isolated_browser: false,
}

const AppProxyPage = () => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const apps = useMemo(() => verge?.app_proxy_apps ?? [], [verge])
  const [form, setForm] = useState<IAppProxyItem>(emptyForm)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [launchedApps, setLaunchedApps] = useState<Record<string, number>>({})
  const isEditing = Boolean(form.id)

  const updateApps = async (nextApps: IAppProxyItem[]) => {
    await patchVerge({ app_proxy_apps: nextApps })
  }

  const selectApp = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
    })

    if (typeof selected !== 'string') return

    setForm((prev) => ({
      ...prev,
      path: selected,
      name: prev.name || getFileName(selected),
    }))
  }

  const saveApp = async () => {
    const path = form.path.trim()
    const name = form.name.trim() || getFileName(path)

    if (!path) {
      showNotice.error('appProxy.page.feedback.pathRequired')
      return
    }

    if (!name) {
      showNotice.error('appProxy.page.feedback.nameRequired')
      return
    }

    const nextItem: IAppProxyItem = {
      id: form.id || createId(),
      name,
      path,
      args: form.args?.trim() || undefined,
      isolated_browser: form.isolated_browser,
    }

    const nextApps = isEditing
      ? apps.map((item) => (item.id === nextItem.id ? nextItem : item))
      : [nextItem, ...apps]

    await updateApps(nextApps)
    setForm(emptyForm)
    showNotice.success(
      isEditing
        ? 'appProxy.page.feedback.updated'
        : 'appProxy.page.feedback.added',
    )
  }

  const editApp = (app: IAppProxyItem) => {
    setForm({
      id: app.id,
      name: app.name,
      path: app.path,
      args: app.args ?? '',
      isolated_browser: app.isolated_browser ?? false,
    })
  }

  const deleteApp = async (id: string) => {
    await updateApps(apps.filter((item) => item.id !== id))
    if (form.id === id) setForm(emptyForm)
    showNotice.success('appProxy.page.feedback.deleted')
  }

  const launchApp = async (app: IAppProxyItem) => {
    setLaunchingId(app.id)
    try {
      const pid = await launchAppWithProxy(app.path, app.args, {
        appId: app.id,
        appName: app.name,
        isolatedBrowser: app.isolated_browser,
      })
      setLaunchedApps((prev) => ({ ...prev, [app.id]: pid }))
      showNotice.success('appProxy.page.feedback.launched', {
        name: app.name,
      })
    } catch (err) {
      showNotice.error('appProxy.page.feedback.launchFailed', err)
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <BasePage title={t('appProxy.page.title')}>
      <Stack spacing={1.5}>
        <Alert severity="info" sx={{ borderRadius: 1 }}>
          {t('appProxy.page.notice')}
        </Alert>

        <Paper
          elevation={0}
          sx={({ palette }) => ({
            p: 2,
            borderRadius: 1,
            border: `1px solid ${palette.divider}`,
            bgcolor: alpha(palette.background.paper, 0.72),
          })}
        >
          <Stack spacing={1.25}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
              {t(
                isEditing
                  ? 'appProxy.page.form.editTitle'
                  : 'appProxy.page.form.addTitle',
              )}
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                size="small"
                fullWidth
                label={t('appProxy.page.form.name')}
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
              <TextField
                size="small"
                fullWidth
                label={t('appProxy.page.form.args')}
                value={form.args}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, args: event.target.value }))
                }
              />
            </Stack>

            <TextField
              size="small"
              fullWidth
              label={t('appProxy.page.form.path')}
              value={form.path}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, path: event.target.value }))
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={t('appProxy.page.actions.choose')}>
                        <IconButton edge="end" size="small" onClick={selectApp}>
                          <FolderOpenRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(form.isolated_browser)}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      isolated_browser: event.target.checked,
                    }))
                  }
                />
              }
              label={t('appProxy.page.form.isolatedBrowser')}
            />

            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              {isEditing && (
                <Button size="small" onClick={() => setForm(emptyForm)}>
                  {t('appProxy.page.actions.cancel')}
                </Button>
              )}
              <Button
                size="small"
                variant="contained"
                startIcon={isEditing ? <SaveRounded /> : <AddRounded />}
                onClick={saveApp}
              >
                {t(
                  isEditing
                    ? 'appProxy.page.actions.save'
                    : 'appProxy.page.actions.add',
                )}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Stack spacing={1}>
          {apps.length === 0 ? (
            <Box sx={{ minHeight: 260 }}>
              <BaseEmpty text={t('appProxy.page.empty')} />
            </Box>
          ) : (
            apps.map((app) => (
              <Paper
                key={app.id}
                elevation={0}
                sx={({ palette }) => ({
                  p: 1.5,
                  borderRadius: 1,
                  border: `1px solid ${palette.divider}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                })}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>
                    {app.name}
                  </Typography>
                  <Typography
                    noWrap
                    sx={({ palette }) => ({
                      color: palette.text.secondary,
                      fontSize: 12,
                    })}
                    title={app.path}
                  >
                    {app.path}
                  </Typography>
                  {app.args && (
                    <Typography
                      noWrap
                      sx={({ palette }) => ({
                        color: palette.text.secondary,
                        fontSize: 12,
                      })}
                    >
                      {app.args}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                    {app.isolated_browser && (
                      <Chip
                        size="small"
                        label={t('appProxy.page.badges.isolatedBrowser')}
                      />
                    )}
                    {launchedApps[app.id] && (
                      <Chip
                        size="small"
                        color="success"
                        label={t('appProxy.page.badges.proxied', {
                          pid: launchedApps[app.id],
                        })}
                      />
                    )}
                  </Stack>
                </Box>

                <Tooltip title={t('appProxy.page.actions.launch')}>
                  <span>
                    <IconButton
                      color="primary"
                      disabled={launchingId === app.id}
                      onClick={() => launchApp(app)}
                    >
                      <PlayArrowRounded />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('appProxy.page.actions.edit')}>
                  <IconButton onClick={() => editApp(app)}>
                    <EditRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('appProxy.page.actions.delete')}>
                  <IconButton color="error" onClick={() => deleteApp(app.id)}>
                    <DeleteRounded />
                  </IconButton>
                </Tooltip>
              </Paper>
            ))
          )}
        </Stack>
      </Stack>
    </BasePage>
  )
}

export default AppProxyPage
