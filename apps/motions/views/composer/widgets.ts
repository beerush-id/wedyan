import type { AnyType } from '@airlib/react';
import { Alert, Avatar, Badge, Button, Card, Chip, Meter, Progress, Stat, Switch } from '@airlib/react-aui';
import type { ComponentType } from 'react';

/**
 * The AUI widgets a stage can show, by name: each is a clip an HTML track takes, its `widget` the
 * name. A widget on a stage is a picture, so these are the ones that are the same at every frame:
 * nothing that runs on its own clock, like a spinner, whose moving parts would differ in a render.
 */
export const WIDGETS: Record<string, ComponentType<AnyType>> = {
  alert: Alert,
  avatar: Avatar,
  badge: Badge,
  button: Button,
  card: Card,
  chip: Chip,
  meter: Meter,
  progress: Progress,
  stat: Stat,
  switch: Switch,
};
