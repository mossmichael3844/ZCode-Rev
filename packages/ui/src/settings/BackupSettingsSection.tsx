import { useCallback, useState } from "react";
import { Switch } from "@/components/ui/switch.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

type EncryptionMode = "aes-256-ctr" | "none";

export function BackupSettingsSection() {
  const { intl } = useZCodeIntl();

  const [enabled, setEnabled] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [bucket, setBucket] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [prefix, setPrefix] = useState("");
  const [encryptionMode, setEncryptionMode] = useState<EncryptionMode>("aes-256-ctr");
  const [passphrase, setPassphrase] = useState("");
  const [includeGitDir, setIncludeGitDir] = useState(true);
  const [includeGitLfs, setIncludeGitLfs] = useState(true);

  const handleManualBackup = useCallback(() => {
    toast(intl.formatMessage({ id: "settings.backup.manualTriggered" }));
  }, [intl]);

  return (
    <div className="space-y-6">
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.backup.description" })}
      </p>

      {/* 启用开关 */}
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.backup.enabled" })}
          description={intl.formatMessage({ id: "settings.backup.enabledDescription" })}
          control={<Switch checked={enabled} onCheckedChange={setEnabled} />}
        />
      </SettingsGroupCard>

      {/* OSS 配置 */}
      <div>
        <h3 className="mb-3 text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.backup.oss" })}
        </h3>
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.oss.accessKeyId" })}
            controlLayout="wide"
            control={
              <Input
                size="lg"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="LTAI5t..."
                className="w-full"
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.oss.accessKeySecret" })}
            controlLayout="wide"
            control={
              <Input
                size="lg"
                type="password"
                value={accessKeySecret}
                onChange={(e) => setAccessKeySecret(e.target.value)}
                className="w-full"
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.oss.bucket" })}
            controlLayout="wide"
            control={
              <Input
                size="lg"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                placeholder="my-backup-bucket"
                className="w-full"
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.oss.endpoint" })}
            controlLayout="wide"
            control={
              <Input
                size="lg"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                className="w-full"
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.oss.prefix" })}
            controlLayout="wide"
            control={
              <Input
                size="lg"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="backups/my-project/"
                className="w-full"
              />
            }
          />
        </SettingsGroupCard>
      </div>

      {/* 加密配置 */}
      <div>
        <h3 className="mb-3 text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.backup.encryption" })}
        </h3>
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.encryption.mode" })}
            control={
              <Select
                value={encryptionMode}
                onValueChange={(v) => setEncryptionMode(v as EncryptionMode)}
              >
                <SelectTrigger size="lg" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aes-256-ctr">
                    {intl.formatMessage({ id: "settings.backup.encryption.modeAes" })}
                  </SelectItem>
                  <SelectItem value="none">
                    {intl.formatMessage({ id: "settings.backup.encryption.modeNone" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {encryptionMode === "aes-256-ctr" ? (
            <SettingsRow
              label={intl.formatMessage({ id: "settings.backup.encryption.passphrase" })}
              description={intl.formatMessage({
                id: "settings.backup.encryption.passphraseDescription",
              })}
              controlLayout="wide"
              control={
                <Input
                  size="lg"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full"
                />
              }
            />
          ) : null}
        </SettingsGroupCard>
      </div>

      {/* 文件过滤 */}
      <div>
        <h3 className="mb-3 text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.backup.filter" })}
        </h3>
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.filter.includeGitDir" })}
            description={intl.formatMessage({
              id: "settings.backup.filter.includeGitDirDescription",
            })}
            control={
              <Switch checked={includeGitDir} onCheckedChange={setIncludeGitDir} />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.filter.includeGitLfs" })}
            description={intl.formatMessage({
              id: "settings.backup.filter.includeGitLfsDescription",
            })}
            control={
              <Switch
                checked={includeGitLfs}
                onCheckedChange={setIncludeGitLfs}
                disabled={!includeGitDir}
              />
            }
          />
        </SettingsGroupCard>
      </div>

      {/* 手动备份 */}
      <div>
        <h3 className="mb-3 text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.backup.manual" })}
        </h3>
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.backup.manualDescription" })}
            control={
              <Button variant="outline" size="lg" onClick={handleManualBackup}>
                {intl.formatMessage({ id: "settings.backup.manualButton" })}
              </Button>
            }
          />
        </SettingsGroupCard>
      </div>
    </div>
  );
}
