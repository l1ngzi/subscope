// Windows toast notification — zero dependencies
export const notify = (title: string, body: string) => {
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName("text")
$text.Item(0).AppendChild($xml.CreateTextNode("${title.replace(/"/g, '`"')}")) | Out-Null
$text.Item(1).AppendChild($xml.CreateTextNode("${body.replace(/"/g, '`"')}")) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("subscope").Show($toast)
`
  try {
    Bun.spawnSync(['powershell', '-NoProfile', '-Command', ps], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}
