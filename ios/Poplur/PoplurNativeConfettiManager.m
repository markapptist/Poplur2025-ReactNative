#import <React/RCTViewManager.h>
#import <SpriteKit/SpriteKit.h>
#import <UIKit/UIKit.h>

@interface PoplurConfettiScene : SKScene
@end

@implementation PoplurConfettiScene

- (instancetype)initWithSize:(CGSize)size
{
  if ((self = [super initWithSize:size])) {
    self.backgroundColor = UIColor.clearColor;
    self.paused = NO;
    [self buildEmitters];
  }
  return self;
}

- (void)didChangeSize:(CGSize)oldSize
{
  [super didChangeSize:oldSize];
  for (SKEmitterNode *emitter in self.children) {
    emitter.position = CGPointMake(self.size.width / 2.0, self.size.height + 24.0);
    emitter.particlePositionRange = CGVectorMake(self.size.width + 120.0, 0.0);
    emitter.particleLifetime = MAX(5.2, self.size.height / 120.0);
  }
}

- (void)buildEmitters
{
  NSArray<UIColor *> *colors = @[
    [UIColor colorWithRed:0.94 green:0.28 blue:0.34 alpha:1.0],
    [UIColor colorWithRed:0.96 green:0.45 blue:0.23 alpha:1.0],
    [UIColor colorWithRed:0.97 green:0.64 blue:0.22 alpha:1.0],
    [UIColor colorWithRed:1.00 green:0.83 blue:0.28 alpha:1.0]
  ];

  for (NSUInteger index = 0; index < colors.count; index++) {
    SKEmitterNode *emitter = [[SKEmitterNode alloc] init];
    emitter.particleTexture = [SKTexture textureWithImage:[self particleImageWithColor:colors[index]]];
    emitter.particleBirthRate = 18.0;
    emitter.numParticlesToEmit = 0;
    emitter.particleLifetime = 7.5;
    emitter.particleLifetimeRange = 2.2;
    emitter.particleSpeed = 132.0 + index * 10.0;
    emitter.particleSpeedRange = 72.0;
    emitter.emissionAngle = -M_PI_2;
    emitter.emissionAngleRange = 0.34;
    emitter.xAcceleration = index % 2 == 0 ? 8.0 : -8.0;
    emitter.yAcceleration = -18.0;
    emitter.particleAlpha = 0.96;
    emitter.particleAlphaRange = 0.08;
    emitter.particleScale = 0.8;
    emitter.particleScaleRange = 0.42;
    emitter.particleRotationRange = M_PI * 2.0;
    emitter.particleRotationSpeed = index % 2 == 0 ? 2.4 : -2.8;
    emitter.position = CGPointMake(self.size.width / 2.0, self.size.height + 24.0);
    emitter.particlePositionRange = CGVectorMake(self.size.width + 120.0, 0.0);
    [self addChild:emitter];
  }
}

- (UIImage *)particleImageWithColor:(UIColor *)color
{
  CGSize size = CGSizeMake(18.0, 7.0);
  UIGraphicsBeginImageContextWithOptions(size, NO, 0.0);
  UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:CGRectMake(0, 0, size.width, size.height) cornerRadius:1.0];
  [color setFill];
  [path fill];
  UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();
  return image;
}

@end

@interface PoplurNativeConfettiView : UIView
@end

@implementation PoplurNativeConfettiView {
  SKView *_skView;
  PoplurConfettiScene *_scene;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = UIColor.clearColor;
    self.userInteractionEnabled = NO;

    _skView = [[SKView alloc] initWithFrame:CGRectZero];
    _skView.backgroundColor = UIColor.clearColor;
    _skView.allowsTransparency = YES;
    _skView.userInteractionEnabled = NO;
    [self addSubview:_skView];

    _scene = [[PoplurConfettiScene alloc] initWithSize:CGSizeMake(1.0, 1.0)];
    _scene.scaleMode = SKSceneScaleModeResizeFill;
    [_skView presentScene:_scene];
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _skView.frame = self.bounds;
  _scene.size = self.bounds.size;
}

@end

@interface PoplurNativeConfettiManager : RCTViewManager
@end

@implementation PoplurNativeConfettiManager

RCT_EXPORT_MODULE(PoplurNativeConfetti)

- (UIView *)view
{
  return [[PoplurNativeConfettiView alloc] initWithFrame:CGRectZero];
}

@end
