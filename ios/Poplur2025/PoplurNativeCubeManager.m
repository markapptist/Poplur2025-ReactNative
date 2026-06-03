#import <React/RCTComponent.h>
#import <React/RCTViewManager.h>
#import <SceneKit/SceneKit.h>
#import <UIKit/UIKit.h>

static NSArray<NSString *> *PoplurTabs(void)
{
  return @[@"feed", @"map", @"record", @"profile", @"settings"];
}

static NSDictionary<NSString *, UIColor *> *PoplurColors(void)
{
  return @{
    @"feed": [UIColor colorWithRed:0.08 green:0.72 blue:0.65 alpha:1.0],
    @"map": [UIColor colorWithRed:0.31 green:0.27 blue:0.90 alpha:1.0],
    @"record": [UIColor colorWithRed:0.98 green:0.45 blue:0.09 alpha:1.0],
    @"profile": [UIColor colorWithRed:0.03 green:0.57 blue:0.70 alpha:1.0],
    @"settings": [UIColor colorWithRed:0.20 green:0.25 blue:0.33 alpha:1.0]
  };
}

@interface PoplurNativeCubeView : UIView
@property (nonatomic, copy) NSString *activeTab;
@property (nonatomic, copy) RCTDirectEventBlock onTabChange;
@end

@implementation PoplurNativeCubeView {
  SCNView *_sceneView;
  SCNNode *_cubeNode;
  UILabel *_faceLabel;
  UIStackView *_rail;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = UIColor.clearColor;
    _activeTab = @"feed";

    _sceneView = [[SCNView alloc] initWithFrame:CGRectZero];
    _sceneView.backgroundColor = UIColor.clearColor;
    _sceneView.allowsCameraControl = NO;
    _sceneView.userInteractionEnabled = YES;
    [self addSubview:_sceneView];

    SCNScene *scene = [SCNScene scene];
    _sceneView.scene = scene;

    SCNNode *cameraNode = [SCNNode node];
    cameraNode.camera = [SCNCamera camera];
    cameraNode.camera.fieldOfView = 38;
    cameraNode.position = SCNVector3Make(0, 0.08, 5.1);
    [scene.rootNode addChildNode:cameraNode];

    SCNNode *ambient = [SCNNode node];
    ambient.light = [SCNLight light];
    ambient.light.type = SCNLightTypeAmbient;
    ambient.light.color = [UIColor colorWithWhite:0.82 alpha:1.0];
    [scene.rootNode addChildNode:ambient];

    SCNNode *key = [SCNNode node];
    key.light = [SCNLight light];
    key.light.type = SCNLightTypeDirectional;
    key.light.color = UIColor.whiteColor;
    key.eulerAngles = SCNVector3Make(-0.72, 0.48, 0.0);
    [scene.rootNode addChildNode:key];

    SCNBox *box = [SCNBox boxWithWidth:1.8 height:1.8 length:1.8 chamferRadius:0.08];
    NSDictionary<NSString *, UIColor *> *colors = PoplurColors();
    NSArray<NSString *> *faceTabs = @[@"map", @"record", @"feed", @"feed", @"profile", @"settings"];
    NSMutableArray<SCNMaterial *> *materials = [NSMutableArray array];
    for (NSString *tab in faceTabs) {
      SCNMaterial *material = [SCNMaterial material];
      material.diffuse.contents = colors[tab];
      material.locksAmbientWithDiffuse = YES;
      material.roughness.contents = @0.42;
      material.metalness.contents = @0.08;
      [materials addObject:material];
    }
    box.materials = materials;

    _cubeNode = [SCNNode nodeWithGeometry:box];
    _cubeNode.eulerAngles = [self rotationForTab:_activeTab];
    [scene.rootNode addChildNode:_cubeNode];

    SCNNode *floor = [SCNNode nodeWithGeometry:[SCNPlane planeWithWidth:2.4 height:0.32]];
    SCNMaterial *floorMaterial = [SCNMaterial material];
    floorMaterial.diffuse.contents = [UIColor colorWithWhite:0 alpha:0.28];
    floorMaterial.doubleSided = YES;
    floor.geometry.materials = @[floorMaterial];
    floor.eulerAngles = SCNVector3Make(-M_PI_2, 0, 0);
    floor.position = SCNVector3Make(0, -1.25, 0);
    [scene.rootNode addChildNode:floor];

    _faceLabel = [[UILabel alloc] initWithFrame:CGRectZero];
    _faceLabel.textAlignment = NSTextAlignmentCenter;
    _faceLabel.textColor = UIColor.whiteColor;
    _faceLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightBlack];
    _faceLabel.layer.shadowColor = UIColor.blackColor.CGColor;
    _faceLabel.layer.shadowOpacity = 0.28;
    _faceLabel.layer.shadowRadius = 8;
    _faceLabel.layer.shadowOffset = CGSizeMake(0, 2);
    [self addSubview:_faceLabel];

    _rail = [[UIStackView alloc] initWithFrame:CGRectZero];
    _rail.axis = UILayoutConstraintAxisHorizontal;
    _rail.alignment = UIStackViewAlignmentCenter;
    _rail.distribution = UIStackViewDistributionEqualSpacing;
    _rail.spacing = 8;
    _rail.backgroundColor = [UIColor colorWithRed:0.02 green:0.03 blue:0.08 alpha:0.76];
    _rail.layer.cornerRadius = 8;
    _rail.layer.borderWidth = 1;
    _rail.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.18].CGColor;
    _rail.layoutMargins = UIEdgeInsetsMake(4, 8, 4, 8);
    _rail.layoutMarginsRelativeArrangement = YES;
    [self addSubview:_rail];
    [self rebuildRail];

    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleTap:)];
    [_sceneView addGestureRecognizer:tap];
    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handlePan:)];
    [_sceneView addGestureRecognizer:pan];

    [self refreshLabel];
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  CGFloat railHeight = 42;
  _sceneView.frame = CGRectMake(0, 0, self.bounds.size.width, self.bounds.size.height - railHeight + 8);
  _rail.frame = CGRectMake(15, self.bounds.size.height - railHeight, self.bounds.size.width - 30, railHeight);
  _faceLabel.frame = CGRectMake(0, 66, self.bounds.size.width, 28);
}

- (void)setActiveTab:(NSString *)activeTab
{
  if (![PoplurTabs() containsObject:activeTab]) {
    activeTab = @"feed";
  }
  if ([_activeTab isEqualToString:activeTab]) {
    return;
  }
  _activeTab = [activeTab copy];
  [self animateToActiveTab];
  [self refreshLabel];
  [self rebuildRail];
}

- (SCNVector3)rotationForTab:(NSString *)tab
{
  if ([tab isEqualToString:@"map"]) {
    return SCNVector3Make(0, -M_PI_2, 0);
  }
  if ([tab isEqualToString:@"record"]) {
    return SCNVector3Make(0, M_PI_2, 0);
  }
  if ([tab isEqualToString:@"profile"]) {
    return SCNVector3Make(M_PI_2, 0, 0);
  }
  if ([tab isEqualToString:@"settings"]) {
    return SCNVector3Make(-M_PI_2, 0, 0);
  }
  return SCNVector3Make(0, 0, 0);
}

- (NSString *)labelForTab:(NSString *)tab
{
  return @{@"feed": @"Feed", @"map": @"Map", @"record": @"Record", @"profile": @"Profile", @"settings": @"Settings"}[tab] ?: @"Feed";
}

- (NSString *)glyphForTab:(NSString *)tab
{
  return @{@"feed": @"F", @"map": @"M", @"record": @"+", @"profile": @"P", @"settings": @"S"}[tab] ?: @"F";
}

- (void)refreshLabel
{
  _faceLabel.text = [self labelForTab:_activeTab];
}

- (void)animateToActiveTab
{
  [SCNTransaction begin];
  [SCNTransaction setAnimationDuration:0.34];
  [SCNTransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut]];
  _cubeNode.eulerAngles = [self rotationForTab:_activeTab];
  [SCNTransaction commit];
}

- (void)rebuildRail
{
  for (UIView *view in _rail.arrangedSubviews) {
    [_rail removeArrangedSubview:view];
    [view removeFromSuperview];
  }

  NSDictionary<NSString *, UIColor *> *colors = PoplurColors();
  for (NSString *tab in PoplurTabs()) {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.accessibilityLabel = [self labelForTab:tab];
    [button setTitle:[self glyphForTab:tab] forState:UIControlStateNormal];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:16 weight:UIFontWeightBlack];
    button.backgroundColor = [_activeTab isEqualToString:tab] ? colors[tab] : [UIColor colorWithWhite:1 alpha:0.10];
    button.layer.cornerRadius = 8;
    button.tag = [PoplurTabs() indexOfObject:tab];
    [button.widthAnchor constraintEqualToConstant:34].active = YES;
    [button.heightAnchor constraintEqualToConstant:34].active = YES;
    [button addTarget:self action:@selector(railButtonPressed:) forControlEvents:UIControlEventTouchUpInside];
    [_rail addArrangedSubview:button];
  }
}

- (void)railButtonPressed:(UIButton *)button
{
  NSArray<NSString *> *tabs = PoplurTabs();
  if (button.tag >= 0 && button.tag < tabs.count) {
    [self sendTab:tabs[button.tag]];
  }
}

- (void)handleTap:(UITapGestureRecognizer *)tap
{
  if (tap.state == UIGestureRecognizerStateEnded) {
    [self sendOffset:1];
  }
}

- (void)handlePan:(UIPanGestureRecognizer *)pan
{
  if (pan.state != UIGestureRecognizerStateEnded) {
    return;
  }
  CGPoint velocity = [pan velocityInView:self];
  CGFloat dominant = fabs(velocity.x) > fabs(velocity.y) ? velocity.x : -velocity.y;
  if (fabs(dominant) < 140) {
    return;
  }
  [self sendOffset:dominant < 0 ? 1 : -1];
}

- (void)sendOffset:(NSInteger)offset
{
  NSArray<NSString *> *tabs = PoplurTabs();
  NSInteger current = [tabs indexOfObject:_activeTab];
  if (current == NSNotFound) {
    current = 0;
  }
  NSInteger next = (current + offset) % tabs.count;
  if (next < 0) {
    next += tabs.count;
  }
  [self sendTab:tabs[next]];
}

- (void)sendTab:(NSString *)tab
{
  if (![PoplurTabs() containsObject:tab]) {
    return;
  }
  if (self.onTabChange) {
    self.onTabChange(@{@"tab": tab});
  }
}

@end

@interface PoplurNativeCubeManager : RCTViewManager
@end

@implementation PoplurNativeCubeManager

RCT_EXPORT_MODULE(PoplurNativeCube)
RCT_EXPORT_VIEW_PROPERTY(activeTab, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTabChange, RCTDirectEventBlock)

- (UIView *)view
{
  return [[PoplurNativeCubeView alloc] initWithFrame:CGRectZero];
}

@end
