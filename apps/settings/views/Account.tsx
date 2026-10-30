import { $bind, $use, Snippet, template } from '@airlib/react';
import { Avatar, Button, TextInput } from '@airlib/react-aui';
import { SettingsGroup, SettingsRow, descriptionOf } from './parts.js';
import { account, assistantName, profile } from './profile.js';

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
export const AccountPage = template(
  () => (
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
            value={$bind(profile, 'userName')}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Signed in">
        <div className={CLASS.IDENTITY}>
          <Avatar size="lg" alt={$use(() => account.name)} src={$use(() => account.picture)} />
          <div className={CLASS.IDENTITY_TEXT}>
            <span className={CLASS.IDENTITY_NAME}>
              <Snippet>{() => account.name}</Snippet>
            </span>
            <span className={CLASS.IDENTITY_EMAIL}>
              <Snippet>{() => account.email}</Snippet>
            </span>
          </div>
          <Button size="sm" variant="tonal">
            Sign out
          </Button>
        </div>
      </SettingsGroup>
    </>
  ),
  'AccountPage'
);
