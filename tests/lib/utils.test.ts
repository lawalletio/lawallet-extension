import { Router } from 'express';
import { Path, globSync } from 'glob';

import {
  DuplicateRoutesError,
  EmptyRoutesError,
  generateSuuid,
  isEmpty,
  jsonParseOrNull,
  jsonStringify,
  nowInSeconds,
  requiredEnvVar,
  requiredProp,
  setUpRoutes,
  setUpSubscriptions,
  shuffled,
  suuid2uuid,
  uuid2suuid,
} from '@lib/utils';
import { Context } from '@type/request';
import NDK, { NDKSubscription } from '@nostr-dev-kit/ndk';
import EventEmitter from 'events';
import { v4 } from 'uuid';

const now: number = 1231006505000;
jest.useFakeTimers({ now });
jest.mock('uuid');
jest.mock('glob', () => {
  const ogModule = jest.requireActual<typeof import('glob')>('glob');
  return {
    __esModule: true,
    ...ogModule,
    globSync: jest.fn(),
  };
});

const globPath = (name: string): Path => {
  return { relative: () => name } as Path;
};

describe('utils', () => {
  describe('setUpRoutes', () => {
    it.each([
      { files: [], expected: EmptyRoutesError },
      {
        files: [globPath('hello.ts'), globPath('hello.ts')],
        expected: DuplicateRoutesError,
      },
    ])('should throw $expected', ({ files, expected }) => {
      jest.mocked(globSync).mockReturnValueOnce(files);

      expect(() => {
        setUpRoutes(Router(), '');
      }).toThrow(expected);
    });

    it('should generate routes correctly', async () => {
      jest.mock(
        '/hello/world/post',
        () => {
          return { default: jest.fn() };
        },
        { virtual: true },
      );
      jest.mock(
        '/hello/world/get',
        () => {
          return { default: jest.fn() };
        },
        { virtual: true },
      );
      jest.mock(
        '/hello/get',
        () => {
          return { default: jest.fn() };
        },
        { virtual: true },
      );
      jest
        .mocked(globSync)
        .mockReturnValueOnce([
          globPath('/hello/world/post.ts'),
          globPath('/hello/world/get.ts'),
          globPath('/hello/get.ts'),
          globPath('/hello/ignored.ts'),
        ]);
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };

      const router: Router = setUpRoutes(Router(), '');
      await Promise.resolve();
      router.stack[9].route.stack[0].handle(null, mockRes);

      expect(router.stack.length).toBe(10);
      expect(router.stack).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { post: true },
              path: '//hello/world',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { get: true },
              path: '//hello/world',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { put: true },
              path: '//hello/world',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { patch: true },
              path: '//hello/world',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { delete: true },
              path: '//hello/world',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { get: true },
              path: '//hello',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { post: true },
              path: '//hello',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { put: true },
              path: '//hello',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { patch: true },
              path: '//hello',
            }),
          }),
          expect.objectContaining({
            route: expect.objectContaining({
              methods: { delete: true },
              path: '//hello',
            }),
          }),
        ]),
      );
      expect(mockRes.status).toHaveBeenCalledWith(405);
    });
  });

  describe('setUpSubscriptions', () => {
    it('should return null when there are duplicates', async () => {
      jest
        .mocked(globSync)
        .mockReturnValueOnce([globPath('hello.ts'), globPath('hello.ts')]);

      const ndk = await setUpSubscriptions(
        {} as Context,
        {} as NDK,
        {} as NDK,
        '',
      );

      expect(ndk).toBeNull();
    });

    it('should set up subscription correctly', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      jest.mock(
        '../../handler1',
        () => {
          return { filter: {}, getHandler: () => handler1 };
        },
        { virtual: true },
      );
      jest.mock(
        '../../handler2',
        () => {
          return { filter: {}, getHandler: handler2 };
        },
        { virtual: true },
      );
      jest
        .mocked(globSync)
        .mockReturnValueOnce([
          globPath('handler1.ts'),
          globPath('handler2.ts'),
          globPath('Invalid/handler/this.ts'),
        ]);
      const ctx = {} as Context;
      const readNDK = {
        subscribe: jest.fn() as any,
      } as NDK;
      const writeNDK = {} as NDK;
      const mockSubTracker = new EventEmitter() as unknown as NDKSubscription;
      const mockSubHandler = new EventEmitter() as unknown as NDKSubscription;
      jest
        .mocked(readNDK.subscribe)
        .mockReturnValueOnce(mockSubTracker)
        .mockReturnValue(mockSubHandler);

      const ndkPromise = setUpSubscriptions(ctx, readNDK, writeNDK, '');
      mockSubTracker.emit('event', {
        content: '100',
        created_at: now / 1000 + 60,
        kind: 31111,
        pubkey: process.env.NOSTR_PUBLIC_KEY,
        tags: [['d', 'lastHandled:/handler1']],
      });
      mockSubTracker.emit('eose');
      mockSubHandler.emit('event', {});
      await Promise.resolve();
      const ndk = await ndkPromise;
      mockSubHandler.emit('event', {});
      await Promise.resolve();

      expect(ndk).toBe(readNDK);
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('requiredEnvVar', () => {
    it('should fail if not env not found', () => {
      expect(() => {
        requiredEnvVar('NOT_EXISTING');
      }).toThrow(Error);
    });

    it('should return existing env var', () => {
      process.env.REAL_VAR = 'hello';

      expect(requiredEnvVar('REAL_VAR')).toBe('hello');

      delete process.env.REAL_VER;
    });
  });

  describe('requiredProp', () => {
    it('should fail if no prop found', () => {
      expect(() => {
        requiredProp({}, 'hello');
      }).toThrow(Error);
    });

    it('should return existing prop', () => {
      expect(requiredProp({ hello: 'world' }, 'hello')).toBe('world');
    });
  });

  describe('nowInSeconds', () => {
    it('should return current timestamp in seconds', () => {
      expect(nowInSeconds()).toEqual(now / 1000);
    });
  });

  describe('isEmpty', () => {
    it.each([
      { obj: {}, expected: true },
      { obj: { hello: undefined }, expected: false },
      { obj: { hello: 'world' }, expected: false },
    ])('should validate correctly $obj', ({ obj, expected }) => {
      expect(isEmpty(obj)).toBe(expected);
    });
  });

  describe('shuffled', () => {
    it.each([
      {
        original: [1, 2, 3, 4, 5],
        rand: [
          0.23239596559586917, 0.09675788832201793, 0.6551478523988861,
          0.8360012068709017,
        ],
        expected: [4, 3, 5, 1, 2],
      },
      {
        original: [1, 2, 3, 4, 5],
        rand: [
          0.24791228155123424, 0.37068634688373936, 0.2693094189219749,
          0.8776158069947135,
        ],
        expected: [3, 4, 1, 5, 2],
      },
      {
        original: ['Lorem', 'ipsum', 'dolor'],
        rand: [0.28642573379948355, 0.8551675718374636],
        expected: ['dolor', 'ipsum', 'Lorem'],
      },
    ])('should shuffle correctly', ({ original, rand, expected }) => {
      for (let n of rand) {
        jest.spyOn(global.Math, 'random').mockReturnValueOnce(n);
      }

      expect(shuffled<(typeof original)[1]>(original)).toEqual(expected);

      jest.spyOn(global.Math, 'random').mockRestore();
    });
  });

  describe('uuid2suuid', () => {
    it.each([
      { uuid: 'this is not an uuid', expected: null },
      { uuid: '', expected: null },
      { uuid: '12345', expected: null },
      {
        uuid: '59cc3d0c-52c7-4882-adde-0233e54aa726',
        expected: 'BZzD0MUsdIgq3eAjPlSqcm',
      },
      {
        uuid: 'e8bb3f8e-6553-4cce-882e-48c09ca064bc',
        expected: 'Douz-OZVNMzoguSMCcoGS8',
      },
      {
        uuid: '52911a11-6107-4135-8627-592b6505f4e4',
        expected: 'BSkRoRYQdBNYYnWStlBfTk',
      },
    ])('should convert $uuid correctly', ({ uuid, expected }) => {
      expect(uuid2suuid(uuid)).toBe(expected);
    });
  });

  describe('suuid2uuid', () => {
    it.each([
      { suuid: 'this is not a suuid', expected: null },
      { suuid: '', expected: null },
      { suuid: '2948dkjvkd?=', expected: null },
      { suuid: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', expected: null },
      {
        suuid: 'BZzD0MUsdIgq3eAjPlSqcm',
        expected: '59cc3d0c-52c7-4882-adde-0233e54aa726',
      },
      {
        suuid: 'Douz-OZVNMzoguSMCcoGS8',
        expected: 'e8bb3f8e-6553-4cce-882e-48c09ca064bc',
      },
      {
        suuid: 'BSkRoRYQdBNYYnWStlBfTk',
        expected: '52911a11-6107-4135-8627-592b6505f4e4',
      },
    ])('should convert $suuid correctly', ({ suuid, expected }) => {
      expect(suuid2uuid(suuid)).toBe(expected);
    });
  });

  describe('generateSuuid', () => {
    it('should generate an uuid and convert it to ssuid', () => {
      jest
        .mocked(v4)
        .mockReturnValueOnce('562005cd-5701-43d6-a66a-6f419eccf702');

      expect(generateSuuid()).toBe('BWIAXNVwFD1qZqb0GezPcC');
    });
  });

  describe('jsonParseOrNull', () => {
    it.each([
      { s: '{', expected: null },
      { s: '', expected: null },
      { s: 'Hello world', expected: null },
      { s: '{}', expected: {} },
      { s: '{"a": [1, 2], "b":"c"}', expected: { a: [1, 2], b: 'c' } },
    ])('should return $expected for "$s"', ({ s, expected }) => {
      expect(jsonParseOrNull(s)).toEqual(expected);
    });
  });

  describe('jsonStringify', () => {
    it.each([
      { v: {}, expected: '{}' },
      { v: { a: [1, 2], b: 'c' }, expected: '{"a":[1,2],"b":"c"}' },
      { v: { a: 100n }, expected: '{"a":"100"}' },
    ])('should return $expected for "$v"', ({ v, expected }) => {
      expect(jsonStringify(v)).toEqual(expected);
    });
  });
});
