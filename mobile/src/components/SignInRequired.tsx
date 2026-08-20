/**
 * The state nine screens were showing with no way out of it.
 *
 * Personal history, baseline, pattern, contacts and the action plan all need an account, and
 * each of them said so and then stopped — there was no sign-in screen anywhere in the app to
 * send the user to. Now there is, so the message carries the way in.
 *
 * The action bubbles up to the tab navigator rather than the local stack, because eight of the
 * nine screens live in a stack that has no sign-in route of its own.
 */
import { CommonActions, useNavigation } from '@react-navigation/native';
import { EmptyState } from './ui';

export function SignInRequired({ title }: { title?: string }) {
  const navigation = useNavigation();
  return (
    <EmptyState
      title={title ?? 'ข้อมูลส่วนตัวต้องลงชื่อเข้าใช้ก่อน'}
      action="ลงชื่อเข้าใช้"
      // Dispatched rather than called through `navigate`, because this component is rendered
      // inside five different stacks and none of their param lists contains the profile tab —
      // a typed call would have to lie about where it is. The action bubbles to the navigator
      // that does know the route.
      onAction={() =>
        navigation.dispatch(
          CommonActions.navigate({ name: 'ProfileTab', params: { screen: 'SignIn' } }),
        )
      }
    />
  );
}
