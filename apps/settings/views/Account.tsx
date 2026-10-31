import { $bind, $use, Snippet, setup } from '@airlib/react';
import { Avatar, TextInput } from '@airlib/react-aui';
import { account } from '@/lib/kernel/account.h.js';
import { SettingsGroup, SettingsRow, descriptionOf } from './parts.js';
import { type SettingsFiles, settingsCtx } from './profile.js';

const CLASS = {
  IDENTITY: 'wedyan-settings-identity',
  IDENTITY_TEXT: 'wedyan-settings-identity-text',
  IDENTITY_NAME: 'wedyan-settings-identity-name',
  IDENTITY_EMAIL: 'wedyan-settings-identity-email',
};

const ID = {
  USER: 'wedyan-settings-user-name',
};

/** Account: the user — what the assistant calls them, and who they're signed in as. */
export const AccountPage = setup(() => {
  const files = settingsCtx.get() as SettingsFiles;
  const { assistantName } = files;
  const signedIn = account.once();

  return () => (
    <>
      <SettingsGroup title="You">
        <SettingsRow
          label="Your name"
          labelId={ID.USER}
          description={
            <>
              What <Snippet>{assistantName}</Snippet> calls you.
            </>
          }
        >
          <TextInput
            aria-labelledby={ID.USER}
            aria-describedby={descriptionOf(ID.USER)}
            placeholder="Your name"
            value={$bind(files.profile, 'userName')}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Signed in">
        <div className={CLASS.IDENTITY}>
          <Avatar size="lg" alt={$use(() => files.profile.userName ?? '')} />
          <div className={CLASS.IDENTITY_TEXT}>
            <span className={CLASS.IDENTITY_NAME}>
              <Snippet>{() => files.profile.userName}</Snippet>
            </span>
            <span className={CLASS.IDENTITY_EMAIL}>
              <Snippet>{() => signedIn.data?.email}</Snippet>
            </span>
          </div>
        </div>
      </SettingsGroup>
    </>
  );
}, 'AccountPage');
